// --- Skills page (chiefeotool.com/skills) ----------------------------------
// A simple showcase page for Claude skills built alongside the ChiefEO tools.
// Follows the same lightweight pattern as Hub.jsx: no router dependency, one
// page component wired in by main.jsx's pathname switch. Adding another skill
// here later is a matter of duplicating the sections below or lifting them
// into a small SKILLS array once there is more than one.

import React from 'react'
import chiefeoLogo from '../assets/chiefeo-logo.png'
import Footer from '../components/Footer.jsx'

const FEATURES = [
  'Answer specific lease questions — permissions, obligations, defined terms, options',
  'Cross-check amendments automatically for modifications',
  'Extract exact language with page citations',
  'Locate leases in project files, chat history, or uploads'
]

const EXAMPLE_QUERIES = [
  'Can the tenant sublet?',
  "What's the landlord's maintenance obligation for HVAC?",
  'What are the business hours?',
  'Does the tenant have a renewal option?'
]

export default function Skills() {
  return (
    <main className="page">
      <a className="back-to-hub" href="https://chiefeotool.com/">← All Tools</a>
      <header className="masthead">
        <img className="brand-logo" src={chiefeoLogo} alt="ChiefEO" />
        <h1>Skills</h1>
      </header>

      <div className="workflow">
        <section className="step step--skill-hero">
          <span className="skill-eyebrow">Claude Skill</span>
          <h2 className="skill-title">Lease Query Lookup</h2>
          <p className="skill-subtitle">
            Amendment-aware lease review for commercial property managers using Claude.
          </p>
        </section>

        <section className="step step--source">
          <div className="step-head">
            <span className="step-eyebrow">Overview</span>
          </div>
          <p>
            Built a skill for commercial property managers working with Claude: <strong>Lease Query Lookup</strong>.
          </p>
          <p>
            Here&rsquo;s the problem I kept hearing about: a tenant asks something like &ldquo;Can we
            sublet?&rdquo; or &ldquo;What&rsquo;s the CAM language?&rdquo; and you need to answer from the
            lease. You find it, then realize an amendment changed it. Now you&rsquo;re cross-referencing
            multiple documents to figure out what actually governs. It&rsquo;s friction that shouldn&rsquo;t
            exist.
          </p>
          <div className="card card--primary">
            <p style={{ margin: 0 }}>
              The skill simplifies this by automating the amendment cross-check. Ask Claude a specific lease
              question — whether it&rsquo;s about tenant permissions, landlord obligations, renewal options,
              or defined terms — and get back the exact language from the lease plus any amendments that
              modified it. Everything&rsquo;s cited with page numbers and sections so you can verify it
              immediately.
            </p>
          </div>
          <p style={{ marginBottom: '0.5rem' }}>It&rsquo;s built specifically for the way PMs work with leases:</p>
          <div className="skill-traits">
            <span className="skill-trait">Query-driven, not blanket reviews</span>
            <span className="skill-trait">Amendment-aware</span>
            <span className="skill-trait">Citation-heavy</span>
          </div>
        </section>

        <section className="step step--source">
          <div className="step-head">
            <span className="step-eyebrow">What It Does</span>
          </div>
          <ul className="skill-feature-list">
            {FEATURES.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </section>

        <section className="step step--source">
          <div className="step-head">
            <span className="step-eyebrow">Installation</span>
          </div>
          <div className="skill-install-card">
            <div>
              <p className="card-label" style={{ marginBottom: '0.25rem' }}>Lease Query Lookup skill</p>
              <p className="card-sub" style={{ margin: 0 }}>
                A single .skill file. Save it to your Claude.ai profile and it&rsquo;s ready to use across
                every conversation.
              </p>
            </div>
            <a className="export-btn skill-download-btn" href="/downloads/lease-query-lookup.skill" download>
              Download .skill file
            </a>
          </div>
          <ol className="skill-steps">
            <li>Download the .skill file above.</li>
            <li>
              In Claude.ai, click <strong>&ldquo;Save skill&rdquo;</strong> to add it to your profile.
            </li>
            <li>That&rsquo;s it — it will trigger automatically when you ask lease-related questions.</li>
          </ol>
        </section>

        <section className="step step--source">
          <div className="step-head">
            <span className="step-eyebrow">Example Queries</span>
          </div>
          <div className="skill-query-grid">
            {EXAMPLE_QUERIES.map((q) => (
              <div className="skill-query-card" key={q}>{q}</div>
            ))}
          </div>
        </section>
      </div>

      <Footer />
    </main>
  )
}
