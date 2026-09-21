pub(crate) mod portfolio;

pub(crate) mod schema;

pub(crate) mod business;

mod portfolio_connection {

    use super::portfolio;

    use std::path::Path;

    use rusqlite::{Connection, OpenFlags};

    use crate::active_workspace::schema::{
        CLOUDFLARE_CREDENTIAL_SCHEMA_EPOCH, CLOUDFLARE_CREDENTIAL_SCHEMA_FINGERPRINT,
    };
    use crate::migrations::run_active_migrations;
    #[cfg(test)]
    use crate::portfolio_projection::PortfolioReadSnapshot;
    use crate::portfolio_projection::{
        AssetLibraryReadSnapshot, DomainDetailReadSnapshot, PortfolioReadError,
    };

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
            run_active_migrations(&mut connection).map_err(|error| match error {
                crate::migrations::MigrationError::RebuildRequiredP007CredentialSchema => {
                    PortfolioReadError::CredentialSchemaRebuildRequired
                }
                crate::migrations::MigrationError::Rejected => PortfolioReadError::SchemaRejected,
            })?;
            require_cloudflare_credential_schema(&connection)?;
            Ok(Self { connection })
        }

        #[cfg(test)]
        pub(crate) fn read_portfolio(
            &self,
            workspace_id: &str,
        ) -> Result<PortfolioReadSnapshot, PortfolioReadError> {
            portfolio::ActivePortfolioReader::new(&self.connection).read(workspace_id)
        }

        pub(crate) fn read_asset_library(
            &self,
            workspace_id: &str,
            start_index: u32,
            size: u16,
            query: &str,
        ) -> Result<AssetLibraryReadSnapshot, PortfolioReadError> {
            portfolio::ActivePortfolioReader::new(&self.connection).read_asset_library(
                workspace_id,
                start_index,
                size,
                query,
            )
        }

        pub(crate) fn read_domain_detail(
            &self,
            workspace_id: &str,
            entity_id: &str,
        ) -> Result<DomainDetailReadSnapshot, PortfolioReadError> {
            portfolio::ActivePortfolioReader::new(&self.connection)
                .read_domain_detail(workspace_id, entity_id)
        }

        pub(crate) fn fixture_connection(&mut self) -> &mut Connection {
            &mut self.connection
        }

        pub(crate) fn raw_connection(&self) -> &Connection {
            &self.connection
        }

        #[cfg(all(test, unix))]
        pub(crate) fn clone_encrypted_to_file(
            &mut self,
            destination: &std::fs::File,
            destination_key: &[u8; 32],
        ) -> Result<(), PortfolioReadError> {
            use std::os::fd::AsRawFd as _;

            let metadata = destination
                .metadata()
                .map_err(|_| PortfolioReadError::StorageRejected)?;
            if !metadata.is_file() || metadata.len() != 0 {
                return Err(PortfolioReadError::StorageRejected);
            }
            let destination_key = crate::sqlcipher_key_sql::raw_key_hex(destination_key);
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            let destination_path = format!("/dev/fd/{}", destination.as_raw_fd());
            #[cfg(not(any(target_os = "macos", target_os = "ios")))]
            let destination_path = format!("/proc/self/fd/{}", destination.as_raw_fd());
            let attach_sql = zeroize::Zeroizing::new(format!(
                "ATTACH DATABASE '{destination_path}' AS rebootstrap_candidate KEY \"x'{}'\";",
                destination_key.as_str()
            ));
            self.connection
                .execute_batch(attach_sql.as_str())
                .map_err(|_| PortfolioReadError::StorageRejected)?;
            // The destination is an already-admitted descriptor rather than a caller-nameable
            // path. SQLite cannot create a sibling rollback journal through /dev/fd (or
            // /proc/self/fd), so the unpublished, empty candidate must remain journal-free while
            // SQLCipher exports into it. The candidate is subsequently opened through its
            // custody-verified pathname, migrated, checkpointed, and required to be in DELETE
            // mode with no sidecars before it can reach PublishIntent.
            let configure = self.connection.execute_batch(
                "PRAGMA rebootstrap_candidate.journal_mode=OFF;
                     PRAGMA rebootstrap_candidate.synchronous=OFF;",
            );
            if configure.is_err() {
                let _ = self
                    .connection
                    .execute("DETACH DATABASE rebootstrap_candidate", []);
                return Err(PortfolioReadError::StorageRejected);
            }
            let export = self.connection.query_row(
                "SELECT sqlcipher_export('rebootstrap_candidate')",
                [],
                |row| row.get::<_, Option<String>>(0),
            );
            let detach = self
                .connection
                .execute("DETACH DATABASE rebootstrap_candidate", []);
            export.map_err(|_| PortfolioReadError::StorageRejected)?;
            detach.map_err(|_| PortfolioReadError::StorageRejected)?;
            destination
                .sync_all()
                .map_err(|_| PortfolioReadError::StorageRejected)
        }
    }

    fn require_cloudflare_credential_schema(
        connection: &Connection,
    ) -> Result<(), PortfolioReadError> {
        let guard = connection.query_row(
            "SELECT schema_epoch,schema_fingerprint
               FROM cloudflare_credential_schema_guard
              WHERE singleton=1",
            [],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        );
        match guard {
            Ok((epoch, fingerprint))
                if epoch == CLOUDFLARE_CREDENTIAL_SCHEMA_EPOCH
                    && fingerprint == CLOUDFLARE_CREDENTIAL_SCHEMA_FINGERPRINT =>
            {
                Ok(())
            }
            _ => Err(PortfolioReadError::CredentialSchemaRebuildRequired),
        }
    }

    pub(crate) fn open_keyed(
        path: &Path,
        key: &[u8; 32],
    ) -> Result<Connection, PortfolioReadError> {
        let flags = OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE;
        let connection = Connection::open_with_flags(path, flags)
            .map_err(|_| PortfolioReadError::StorageRejected)?;
        let key_sql = crate::sqlcipher_key_sql::key_pragma(key);
        connection
            .execute_batch(key_sql.as_str())
            .map_err(|_| PortfolioReadError::StorageRejected)?;
        crate::sqlcipher_process_policy::apply(&connection)
            .map_err(|_| PortfolioReadError::StorageRejected)?;
        connection
            .execute_batch(
                "PRAGMA trusted_schema = OFF;
            PRAGMA foreign_keys = ON;
            PRAGMA recursive_triggers = ON;
            PRAGMA busy_timeout = 5000;",
            )
            .map_err(|_| PortfolioReadError::StorageRejected)?;
        connection
            .query_row("SELECT count(*) FROM sqlite_schema", [], |row| {
                row.get::<_, i64>(0)
            })
            .map_err(|_| PortfolioReadError::StorageRejected)?;
        Ok(connection)
    }

    #[cfg(test)]
    pub(crate) fn clone_keyed_database(
        source: &Path,
        source_key: &[u8; 32],
        destination: &Path,
        destination_key: &[u8; 32],
    ) -> Result<(), PortfolioReadError> {
        if source == destination || destination.exists() {
            return Err(PortfolioReadError::StorageRejected);
        }
        let connection = open_keyed(source, source_key)?;
        let destination_key = crate::sqlcipher_key_sql::raw_key_hex(destination_key);
        let destination_path = destination
            .to_str()
            .ok_or(PortfolioReadError::StorageRejected)?;
        let escaped_path = destination_path.replace('\'', "''");
        let attach_sql = zeroize::Zeroizing::new(format!(
            "ATTACH DATABASE '{escaped_path}' AS encrypted KEY \"x'{}'\";",
            destination_key.as_str()
        ));
        connection
            .execute_batch(attach_sql.as_str())
            .map_err(|_| PortfolioReadError::StorageRejected)?;
        let export = connection.query_row("SELECT sqlcipher_export('encrypted')", [], |row| {
            row.get::<_, Option<String>>(0)
        });
        let detach = connection.execute("DETACH DATABASE encrypted", []);
        export.map_err(|_| PortfolioReadError::StorageRejected)?;
        detach.map_err(|_| PortfolioReadError::StorageRejected)?;
        let file =
            std::fs::File::open(destination).map_err(|_| PortfolioReadError::StorageRejected)?;
        file.sync_all()
            .map_err(|_| PortfolioReadError::StorageRejected)
    }
}

pub(crate) use portfolio_connection::*;
