//! Which Provider observations a read may report.
//!
//! An observation row is written while its run is still in flight, so a read that took the latest
//! row would report evidence the Host has not finished confirming, and a running or failed run
//! would hide an older confirmed observation. Every read therefore keeps only observations whose run
//! completed (`succeeded` or `partial`) and whose target for the same asset succeeded.

/// SQL condition that the observation row aliased `alias` was confirmed by a completed run.
/// `alias` is always a fixed table alias written in this crate, never input.
pub(crate) fn confirmed(alias: &str) -> String {
    format!(
        "EXISTS (SELECT 1 FROM provider_observation_runs run
           JOIN provider_observation_targets target
             ON target.workspace_id = run.workspace_id
            AND target.observation_run_id = run.observation_run_id
          WHERE run.workspace_id = {alias}.workspace_id
            AND run.observation_run_id = {alias}.observation_run_id
            AND run.status IN ('succeeded', 'partial')
            AND target.entity_id = {alias}.entity_id
            AND target.status = 'succeeded')"
    )
}
