//! A piece table: the edited content of a file as a sequence of pieces that refer either to the
//! original file or to an append-only buffer of added bytes.
//!
//! The original file is never loaded into memory and is never modified. Every edit is a
//! [`PieceTable::replace`] of a byte range with new pieces, which also makes undo cheap: an edit is
//! undone by putting the removed pieces back, without copying any file data.

use std::io;

/// Where the bytes of a piece come from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
    /// The original file.
    Original,
    /// The buffer of added bytes.
    Added,
}

/// A run of bytes taken from one source.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Piece {
    pub source: Source,
    /// The offset of the first byte in the source.
    pub start: u64,
    /// The number of bytes.
    pub len: u64,
}

impl Piece {
    fn end(&self) -> u64 {
        self.start + self.len
    }
}

/// The total length of a list of pieces.
pub fn pieces_len(pieces: &[Piece]) -> u64 {
    pieces.iter().map(|piece| piece.len).sum()
}

/// The edited content of a file.
#[derive(Debug, Clone)]
pub struct PieceTable {
    added: Vec<u8>,
    pieces: Vec<Piece>,
    len: u64,
}

impl PieceTable {
    /// Creates a table for an unedited file of `original_len` bytes.
    pub fn new(original_len: u64) -> Self {
        let pieces = if original_len > 0 {
            vec![Piece {
                source: Source::Original,
                start: 0,
                len: original_len,
            }]
        } else {
            Vec::new()
        };

        Self {
            added: Vec::new(),
            pieces,
            len: original_len,
        }
    }

    /// The length of the edited content.
    pub fn len(&self) -> u64 {
        self.len
    }

    /// Appends bytes to the added buffer and returns the pieces that refer to them.
    pub fn add_bytes(&mut self, data: &[u8]) -> Vec<Piece> {
        if data.is_empty() {
            return Vec::new();
        }
        let start = self.added.len() as u64;
        self.added.extend_from_slice(data);
        vec![Piece {
            source: Source::Added,
            start,
            len: data.len() as u64,
        }]
    }

    /// Replaces `remove_len` bytes at `offset` with `insert` and returns the removed pieces.
    ///
    /// `remove_len` is shortened if the range extends past the end of the content.
    ///
    /// # Panics
    /// If `offset` is past the end of the content.
    pub fn replace(&mut self, offset: u64, remove_len: u64, insert: &[Piece]) -> Vec<Piece> {
        assert!(
            offset <= self.len,
            "offset {offset} is past the end ({})",
            self.len
        );
        let remove_len = remove_len.min(self.len - offset);

        let start_index = self.split_at(offset);
        let end_index = self.split_at(offset + remove_len);
        let insert: Vec<Piece> = insert.iter().copied().filter(|p| p.len > 0).collect();
        let insert_count = insert.len();
        let removed: Vec<Piece> = self.pieces.splice(start_index..end_index, insert).collect();

        self.len = self.len - remove_len
            + pieces_len(&self.pieces[start_index..start_index + insert_count]);
        self.merge_range(
            start_index.saturating_sub(1),
            start_index + insert_count + 1,
        );
        removed
    }

    /// Reads up to `length` bytes starting from `offset`. The result is shorter when the range
    /// extends past the end of the content.
    ///
    /// `read_original` must fill the buffer with the original file's bytes starting at the given offset.
    pub fn read(
        &self,
        offset: u64,
        length: usize,
        mut read_original: impl FnMut(u64, &mut [u8]) -> io::Result<()>,
    ) -> io::Result<Vec<u8>> {
        if offset >= self.len || length == 0 {
            return Ok(Vec::new());
        }
        let length = (length as u64).min(self.len - offset) as usize;
        let mut result = vec![0u8; length];
        let mut written = 0usize;
        let mut position = 0u64;

        for piece in &self.pieces {
            let piece_end = position + piece.len;
            let read_from = offset + written as u64;
            if piece_end <= read_from {
                position = piece_end;
                continue;
            }

            let skip = read_from - position;
            let count = ((piece.len - skip) as usize).min(length - written);
            let target = &mut result[written..written + count];
            let source_start = piece.start + skip;

            match piece.source {
                Source::Original => read_original(source_start, target)?,
                Source::Added => {
                    let start = source_start as usize;
                    target.copy_from_slice(&self.added[start..start + count]);
                }
            }

            written += count;
            if written == length {
                break;
            }
            position = piece_end;
        }

        Ok(result)
    }

    /// Splits the piece containing `offset` so that a piece boundary falls on `offset`.
    /// Returns the index of the first piece starting at or after `offset`.
    fn split_at(&mut self, offset: u64) -> usize {
        let mut position = 0u64;
        for index in 0..self.pieces.len() {
            if position == offset {
                return index;
            }
            let piece = self.pieces[index];
            if offset < position + piece.len {
                let head = offset - position;
                self.pieces[index].len = head;
                self.pieces.insert(
                    index + 1,
                    Piece {
                        source: piece.source,
                        start: piece.start + head,
                        len: piece.len - head,
                    },
                );
                return index + 1;
            }
            position += piece.len;
        }
        self.pieces.len()
    }

    /// Joins neighboring pieces in `from..to` that continue each other in the same source.
    fn merge_range(&mut self, from: usize, to: usize) {
        let mut index = from;
        while index + 1 < self.pieces.len().min(to + 1) {
            let (current, next) = (self.pieces[index], self.pieces[index + 1]);
            if current.source == next.source && current.end() == next.start {
                self.pieces[index].len += next.len;
                self.pieces.remove(index + 1);
            } else {
                index += 1;
            }
        }
    }

    #[cfg(test)]
    fn piece_count(&self) -> usize {
        self.pieces.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A table over `original` and a reader for it.
    fn table(original: &[u8]) -> PieceTable {
        PieceTable::new(original.len() as u64)
    }

    fn read_all(table: &PieceTable, original: &[u8]) -> Vec<u8> {
        table
            .read(0, usize::MAX, |offset, buffer| {
                let start = offset as usize;
                buffer.copy_from_slice(&original[start..start + buffer.len()]);
                Ok(())
            })
            .unwrap()
    }

    fn read(table: &PieceTable, original: &[u8], offset: u64, length: usize) -> Vec<u8> {
        table
            .read(offset, length, |offset, buffer| {
                let start = offset as usize;
                buffer.copy_from_slice(&original[start..start + buffer.len()]);
                Ok(())
            })
            .unwrap()
    }

    #[test]
    fn unedited_table_reads_original() {
        let original = b"0123456789";
        let table = table(original);

        assert_eq!(table.len(), 10);
        assert_eq!(read_all(&table, original), original);
        assert_eq!(read(&table, original, 3, 4), b"3456");
        assert_eq!(read(&table, original, 8, 100), b"89");
        assert!(read(&table, original, 10, 5).is_empty());
    }

    #[test]
    fn insert_overwrite_and_delete() {
        let original = b"0123456789";
        let mut table = table(original);

        let inserted = table.add_bytes(b"ab");
        table.replace(2, 0, &inserted);
        assert_eq!(read_all(&table, original), b"01ab23456789");

        let overwrite = table.add_bytes(b"XYZ");
        table.replace(5, 3, &overwrite);
        assert_eq!(read_all(&table, original), b"01ab2XYZ6789");

        table.replace(0, 3, &[]);
        assert_eq!(read_all(&table, original), b"b2XYZ6789");
        assert_eq!(table.len(), 9);
    }

    #[test]
    fn remove_length_is_clamped_at_end() {
        let original = b"abc";
        let mut table = table(original);

        table.replace(1, 100, &[]);

        assert_eq!(read_all(&table, original), b"a");
    }

    #[test]
    fn append_to_empty_file() {
        let mut table = PieceTable::new(0);
        let pieces = table.add_bytes(b"hi");
        table.replace(0, 0, &pieces);

        assert_eq!(read_all(&table, b""), b"hi");
    }

    #[test]
    fn replace_returns_removed_pieces_for_undo() {
        let original = b"0123456789";
        let mut table = table(original);

        let inserted = table.add_bytes(b"AB");
        let removed = table.replace(3, 4, &inserted);
        assert_eq!(read_all(&table, original), b"012AB789");

        // Undo: put the removed pieces back in place of the inserted ones.
        table.replace(3, pieces_len(&inserted), &removed);
        assert_eq!(read_all(&table, original), original);
    }

    #[test]
    fn sequential_typing_keeps_few_pieces() {
        let original = b"0123456789";
        let mut table = table(original);

        for (i, byte) in b"abcde".iter().enumerate() {
            let pieces = table.add_bytes(&[*byte]);
            table.replace(2 + i as u64, 1, &pieces);
        }

        assert_eq!(read_all(&table, original), b"01abcde789");
        // Original head, the added run, and the original tail.
        assert_eq!(table.piece_count(), 3);
    }

    #[test]
    #[should_panic(expected = "past the end")]
    fn replace_past_end_panics() {
        let mut table = table(b"abc");
        table.replace(4, 0, &[]);
    }

    /// A small deterministic random number generator for the model test.
    struct Rng(u64);

    impl Rng {
        fn next(&mut self) -> u64 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            self.0
        }

        fn below(&mut self, max: u64) -> u64 {
            if max == 0 {
                0
            } else {
                self.next() % max
            }
        }
    }

    #[test]
    fn random_edits_match_a_vec_model() {
        let original: Vec<u8> = (0..200u32).map(|i| (i % 251) as u8).collect();
        let mut table = table(&original);
        let mut model = original.clone();
        let mut rng = Rng(0x9e37_79b9_7f4a_7c15);
        let mut undo: Vec<(u64, u64, Vec<Piece>)> = Vec::new();

        for step in 0..2000 {
            let len = model.len() as u64;
            let offset = rng.below(len + 1);
            let remove = rng.below(8).min(len - offset);
            let data: Vec<u8> = (0..rng.below(6)).map(|_| rng.next() as u8).collect();

            let inserted = table.add_bytes(&data);
            let removed = table.replace(offset, remove, &inserted);
            undo.push((offset, data.len() as u64, removed));
            model.splice(
                offset as usize..(offset + remove) as usize,
                data.iter().copied(),
            );

            assert_eq!(table.len(), model.len() as u64, "length after step {step}");
            if step % 50 == 0 {
                assert_eq!(
                    read_all(&table, &original),
                    model,
                    "content after step {step}"
                );
                let at = rng.below(model.len() as u64 + 1);
                let count = rng.below(40) as usize;
                let end = (at as usize + count).min(model.len());
                assert_eq!(read(&table, &original, at, count), model[at as usize..end]);
            }
        }

        assert_eq!(read_all(&table, &original), model);

        // Undoing every edit in reverse order restores the original.
        while let Some((offset, inserted_len, removed)) = undo.pop() {
            table.replace(offset, inserted_len, &removed);
        }
        assert_eq!(read_all(&table, &original), original);
    }
}
