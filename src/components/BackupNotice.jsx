import React from 'react'

// --- Insufficient-backup notice (presentation only) -------------------------
// A short, non-alarming notice shown in the results area (beside the Fix A
// enrichment status) when a supporting input that would have strengthened the
// variance commentary was not provided. All logic lives in the pure
// `backupNotice` helper; this component only renders the precomputed object and
// returns null when there is nothing to recommend.
export default function BackupNotice({ notice }) {
  if (!notice || !Array.isArray(notice.recommendations) || notice.recommendations.length === 0) return null

  return (
    <div className="backup-notice" role="status">
      <span className="backup-notice-title">Your backup was limited</span>
      <ul className="backup-notice-list">
        {notice.recommendations.map((rec, i) => (
          <li key={i}>{rec}</li>
        ))}
      </ul>
    </div>
  )
}
