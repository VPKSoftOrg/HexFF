//! Undo and redo for a [`PieceTable`].
//!
//! Each [`Change`] stores the pieces it removed and inserted, so undoing or redoing never copies
//! file data, even for large deletions. Changes are grouped into steps; one undo or redo applies a
//! whole step, which lets consecutive keystrokes be undone together.

use crate::piece_table::{pieces_len, Piece, PieceTable};

/// One replacement of a byte range.
#[derive(Debug, Clone)]
pub struct Change {
    offset: u64,
    removed: Vec<Piece>,
    inserted: Vec<Piece>,
}

impl Change {
    /// Applies `remove_len` bytes at `offset` being replaced with `data` and records the change.
    pub fn apply(table: &mut PieceTable, offset: u64, remove_len: u64, data: &[u8]) -> Self {
        let inserted = table.add_bytes(data);
        let removed = table.replace(offset, remove_len, &inserted);
        Self {
            offset,
            removed,
            inserted,
        }
    }

    fn undo(&self, table: &mut PieceTable) {
        table.replace(self.offset, pieces_len(&self.inserted), &self.removed);
    }

    fn redo(&self, table: &mut PieceTable) {
        table.replace(self.offset, pieces_len(&self.removed), &self.inserted);
    }

    /// The offset of the change.
    pub fn offset(&self) -> u64 {
        self.offset
    }
}

/// A group of changes that is undone and redone together.
#[derive(Debug)]
struct Step {
    id: u64,
    changes: Vec<Change>,
}

impl Step {
    /// The smallest offset touched by the step, where the cursor goes after undo or redo.
    fn offset(&self) -> u64 {
        self.changes.iter().map(Change::offset).min().unwrap_or(0)
    }
}

/// The undo and redo stacks of a document.
#[derive(Debug, Default)]
pub struct History {
    undo: Vec<Step>,
    redo: Vec<Step>,
    next_id: u64,
    /// The id of the top undo step when the document was last saved; 0 is the unedited state.
    saved_id: u64,
}

impl History {
    /// Records a change that has been applied.
    ///
    /// With `continue_step`, the change joins the latest undo step so they are undone together,
    /// unless that step is the saved state (which must stay a separate step to track modification).
    /// Recording a change clears the redo stack.
    pub fn record(&mut self, change: Change, continue_step: bool) {
        self.redo.clear();
        if continue_step {
            if let Some(last) = self.undo.last_mut() {
                if last.id != self.saved_id {
                    last.changes.push(change);
                    return;
                }
            }
        }
        self.next_id += 1;
        self.undo.push(Step {
            id: self.next_id,
            changes: vec![change],
        });
    }

    /// Undoes the latest step. Returns the offset of the undone change, or `None` if there was nothing to undo.
    pub fn undo(&mut self, table: &mut PieceTable) -> Option<u64> {
        let step = self.undo.pop()?;
        for change in step.changes.iter().rev() {
            change.undo(table);
        }
        let offset = step.offset();
        self.redo.push(step);
        Some(offset)
    }

    /// Redoes the latest undone step. Returns the offset of the redone change, or `None` if there was nothing to redo.
    pub fn redo(&mut self, table: &mut PieceTable) -> Option<u64> {
        let step = self.redo.pop()?;
        for change in &step.changes {
            change.redo(table);
        }
        let offset = step.offset();
        self.undo.push(step);
        Some(offset)
    }

    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }

    fn current_id(&self) -> u64 {
        self.undo.last().map(|step| step.id).unwrap_or(0)
    }

    /// Whether the content differs from the last saved (or opened) state.
    pub fn is_modified(&self) -> bool {
        self.current_id() != self.saved_id
    }

    /// Marks the current state as saved.
    #[allow(dead_code)] // Used by saving (next phase) and the tests.
    pub fn mark_saved(&mut self) {
        self.saved_id = self.current_id();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn content(table: &PieceTable, original: &[u8]) -> Vec<u8> {
        table
            .read(0, usize::MAX, |offset, buffer| {
                let start = offset as usize;
                buffer.copy_from_slice(&original[start..start + buffer.len()]);
                Ok(())
            })
            .unwrap()
    }

    #[test]
    fn undo_and_redo_restore_content() {
        let original = b"0123456789";
        let mut table = PieceTable::new(10);
        let mut history = History::default();

        history.record(Change::apply(&mut table, 2, 3, b"ab"), false);
        history.record(Change::apply(&mut table, 0, 0, b"XY"), false);
        assert_eq!(content(&table, original), b"XY01ab56789");

        assert_eq!(history.undo(&mut table), Some(0));
        assert_eq!(content(&table, original), b"01ab56789");
        assert_eq!(history.undo(&mut table), Some(2));
        assert_eq!(content(&table, original), original);
        assert_eq!(history.undo(&mut table), None);

        assert_eq!(history.redo(&mut table), Some(2));
        assert_eq!(history.redo(&mut table), Some(0));
        assert_eq!(content(&table, original), b"XY01ab56789");
        assert_eq!(history.redo(&mut table), None);
    }

    #[test]
    fn continued_changes_undo_together() {
        let original = b"0000";
        let mut table = PieceTable::new(4);
        let mut history = History::default();

        history.record(Change::apply(&mut table, 0, 1, b"a"), false);
        history.record(Change::apply(&mut table, 1, 1, b"b"), true);
        history.record(Change::apply(&mut table, 2, 1, b"c"), true);
        assert_eq!(content(&table, original), b"abc0");

        history.undo(&mut table);
        assert_eq!(content(&table, original), original);
        assert!(!history.can_undo());
    }

    #[test]
    fn new_change_clears_redo() {
        let mut table = PieceTable::new(4);
        let mut history = History::default();

        history.record(Change::apply(&mut table, 0, 1, b"a"), false);
        history.undo(&mut table);
        assert!(history.can_redo());

        history.record(Change::apply(&mut table, 1, 1, b"b"), false);
        assert!(!history.can_redo());
    }

    #[test]
    fn modified_follows_undo_redo_and_save() {
        let mut table = PieceTable::new(4);
        let mut history = History::default();
        assert!(!history.is_modified());

        history.record(Change::apply(&mut table, 0, 1, b"a"), false);
        assert!(history.is_modified());

        history.undo(&mut table);
        assert!(!history.is_modified());

        history.redo(&mut table);
        history.mark_saved();
        assert!(!history.is_modified());

        history.undo(&mut table);
        assert!(history.is_modified());
        history.redo(&mut table);
        assert!(!history.is_modified());
    }

    #[test]
    fn continuing_does_not_join_the_saved_step() {
        let mut table = PieceTable::new(4);
        let mut history = History::default();

        history.record(Change::apply(&mut table, 0, 1, b"a"), false);
        history.mark_saved();
        history.record(Change::apply(&mut table, 1, 1, b"b"), true);
        assert!(history.is_modified());

        history.undo(&mut table);
        assert!(!history.is_modified());
    }

    #[test]
    fn saved_state_lost_to_cleared_redo_stays_modified() {
        let mut table = PieceTable::new(4);
        let mut history = History::default();

        history.record(Change::apply(&mut table, 0, 1, b"a"), false);
        history.mark_saved();
        history.undo(&mut table);
        history.record(Change::apply(&mut table, 0, 1, b"b"), false);

        assert!(history.is_modified());
    }
}
