use super::*;
use crate::active_workspace::business::{SellerHubConnectionSeed, SellerHubInventoryCommit};
use crate::{DesktopSellerHubListingFact, DesktopSellerHubListingState};

const AT: &str = "2026-11-20T00:00:00Z";
const EXECUTION: (&str, u64) = ("device-local", 1);

#[test]
fn replicated_asset_re_add_retires_old_bindings_on_each_connection() {
    let mut db = database();
    let create = generation_mutation(
        "other-create",
        "remote.test",
        1,
        0,
        &serde_json::json!([{"fieldPath": "note", "value": "first life"}]),
    );
    db.apply_sync_page_v2(
        "reader-local",
        &generation_page(0, vec![create]),
        "confirm-1",
    )
    .unwrap();
    let listing = [DesktopSellerHubListingFact {
        domain: "remote.test".to_owned(),
        state: DesktopSellerHubListingState::OnSale,
        enabled_bin_price_usd: None,
    }];
    let observe = |db: &mut BusinessDatabase, seed: &SellerHubConnectionSeed, exec: (&str, u64)| {
        db.import_sellerhub_inventory(
            &SellerHubInventoryCommit {
                seed,
                listings: &listing,
                device_id: exec.0,
                lease_epoch: exec.1,
                at: AT,
            },
            || Ok(()),
        )
    };
    let a = db
        .prepare_sellerhub_connection("SellerHub A", AT, EXECUTION, || Ok(()))
        .unwrap();
    let b = db
        .prepare_sellerhub_connection("SellerHub B", AT, EXECUTION, || Ok(()))
        .unwrap();
    assert_eq!(
        observe(&mut db, &a, ("device-local", 2)),
        Err(BusinessDatabaseError::MutationStale)
    );
    assert_eq!(
        observe(&mut db, &a, ("other-device", 1)),
        Err(BusinessDatabaseError::MutationStale)
    );
    observe(&mut db, &a, EXECUTION).unwrap();
    observe(&mut db, &b, EXECUTION).unwrap();
    let fresh_generation = |db: &BusinessDatabase, connection_id: &str| {
        db.store.raw_connection().query_row(
            "SELECT sellerhub_asset_generation FROM marketplace_listing_observations_read_facts
             WHERE entity_id='remote.test' AND binding_connection_id=?1 AND binding_fresh=1 AND connection_rank=1",
            [connection_id], |row| row.get::<_, i64>(0),
        ).optional().unwrap()
    };
    assert_eq!(fresh_generation(&db, &a.connection_id), Some(1));
    assert_eq!(fresh_generation(&db, &b.connection_id), Some(1));
    let delete = generation_mutation("other-delete", "remote.test", 1, 1, &serde_json::json!([]));
    db.apply_sync_page_v2(
        "reader-local",
        &generation_page(1, vec![delete]),
        "confirm-2",
    )
    .unwrap();
    db.apply_sync_page_v2(
        "reader-local",
        &generation_page(2, vec![re_add_mutation(2, 2, 2)]),
        "confirm-3",
    )
    .unwrap();
    assert_eq!(fresh_generation(&db, &a.connection_id), None);
    assert_eq!(fresh_generation(&db, &b.connection_id), None);

    let pending_a = db
        .queue_sellerhub_scan(&a.connection_id, EXECUTION, || Ok(()))
        .unwrap();
    observe(&mut db, &pending_a, EXECUTION).unwrap();
    assert_eq!(fresh_generation(&db, &a.connection_id), Some(2));
    assert_eq!(fresh_generation(&db, &b.connection_id), None);
    let count =
        |db: &BusinessDatabase, id: &str, status: &str| {
            db.store.raw_connection().query_row(
            "SELECT count(*) FROM domain_asset_provider_bindings WHERE entity_id='remote.test'
             AND provider_kind='spaceship' AND resource_kind='listing' AND connection_id=?1
             AND validation_status=?2",
            params![id, status], |row| row.get::<_, i64>(0),
        ).unwrap()
        };
    assert_eq!(count(&db, &a.connection_id, "detached"), 1);
    assert_eq!(count(&db, &a.connection_id, "unverified"), 1);
    assert_eq!(count(&db, &b.connection_id, "detached"), 0);
}
