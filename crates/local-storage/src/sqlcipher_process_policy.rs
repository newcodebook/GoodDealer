#[cfg(not(test))]
pub(crate) fn apply(connection: &rusqlite::Connection) -> rusqlite::Result<()> {
    connection.execute_batch("PRAGMA cipher_memory_security = ON;")
}

#[cfg(test)]
#[expect(
    clippy::unnecessary_wraps,
    reason = "the unit no-op preserves the production helper's fallible private contract"
)]
pub(crate) fn apply(connection: &rusqlite::Connection) -> rusqlite::Result<()> {
    let _ = connection;
    Ok(())
}
