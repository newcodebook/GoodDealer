pub(crate) mod portfolio;

pub(crate) mod schema;

pub mod business;

mod portfolio_connection {

    use super::portfolio;

    use std::path::Path;

    use rusqlite::{Connection, OpenFlags};

    use crate::migrations::run_active_migrations;
    use crate::portfolio_projection::{PortfolioReadError, PortfolioReadSnapshot};

    pub(crate) struct ActiveWorkspaceKey(pub(crate) [u8; 32]);

    pub(crate) struct ActiveWorkspaceConnection {
        connection: Connection,
    }

    impl ActiveWorkspaceConnection {
        pub(crate) fn create(
            path: &Path,
            key: &ActiveWorkspaceKey,
        ) -> Result<Self, PortfolioReadError> {
            let mut connection = open_keyed(path, &key.0)?;
            connection
                .pragma_update(None, "journal_mode", "WAL")
                .map_err(|_| PortfolioReadError::StorageRejected)?;
            run_active_migrations(&mut connection)
                .map_err(|_| PortfolioReadError::SchemaRejected)?;
            Ok(Self { connection })
        }

        pub(crate) fn read_portfolio(
            &self,
            workspace_id: &str,
        ) -> Result<PortfolioReadSnapshot, PortfolioReadError> {
            portfolio::ActivePortfolioReader::new(&self.connection).read(workspace_id)
        }

        pub(crate) fn fixture_connection(&mut self) -> &mut Connection {
            &mut self.connection
        }

        pub(crate) fn raw_connection(&self) -> &Connection {
            &self.connection
        }
    }

    pub(crate) fn open_keyed(
        path: &Path,
        key: &[u8; 32],
    ) -> Result<Connection, PortfolioReadError> {
        let flags = OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE;
        let connection = Connection::open_with_flags(path, flags)
            .map_err(|_| PortfolioReadError::StorageRejected)?;
        let key = key
            .iter()
            .fold(String::with_capacity(64), |mut output, byte| {
                use std::fmt::Write;
                write!(output, "{byte:02x}").expect("writing into a String cannot fail");
                output
            });
        connection
            .execute_batch(&format!(
                "PRAGMA key = \"x'{key}'\";
            PRAGMA cipher_memory_security = ON;
            PRAGMA trusted_schema = OFF;
            PRAGMA foreign_keys = ON;
            PRAGMA recursive_triggers = ON;
            PRAGMA busy_timeout = 5000;"
            ))
            .map_err(|_| PortfolioReadError::StorageRejected)?;
        connection
            .query_row("SELECT count(*) FROM sqlite_schema", [], |row| {
                row.get::<_, i64>(0)
            })
            .map_err(|_| PortfolioReadError::StorageRejected)?;
        Ok(connection)
    }
}

pub(crate) use portfolio_connection::*;
