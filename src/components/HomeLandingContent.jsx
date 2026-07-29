// --- Homepage SEO landing content -----------------------------------------
// Indexable copy for chiefeotool.com/, rendered by the hub below the tool
// buttons. Content is the SEO package's landing_page_vng.md; DEPLOYMENT_CHECKLIST.md
// maps the VNG landing copy to the homepage, since VNG has no URL of its own
// separate from it. The package's practitioner byline is deliberately not
// included — see docs/seo-integration-notes.md.
//
// Deliberately appended *after* the tool list and share row: the hub's job is
// still "pick a tool" above the fold — this is additive content below it,
// nothing about the existing flow moves or changes.

import React from 'react'

export default function HomeLandingContent() {
  return (
    <div className="home-landing">
      <section>
        <h2>Your GL already knows why the number moved. VNG just writes it down.</h2>
        <p>
          Every month, someone on your accounting team stares at a budget-vs-actual report, finds
          the line items that jumped, and starts typing an explanation an owner will actually
          accept. VNG reads your GL variance data and drafts that narrative for you — grounded in
          the actual transactions behind the number, not a guess at what probably happened.
        </p>
        <a className="home-landing-cta" href="/vng">Try VNG Now →</a>
      </section>

      <section>
        <h3>Who this is for</h3>
        <ul>
          <li>
            <strong>Assistant property managers</strong> who inherit “write the variance narratives”
            as a monthly task and want it done in minutes instead of an afternoon.
          </li>
          <li>
            <strong>Junior PMs</strong> still learning which variances matter and which are noise —
            VNG shows its work, so it doubles as a way to see how a variance actually traces back to
            GL activity.
          </li>
          <li>
            <strong>Property accountants</strong> who need commentary that will hold up when an
            owner or asset manager asks a follow-up question, because the narrative is tied to real
            transaction detail, not a plausible-sounding paragraph.
          </li>
          <li>
            <strong>Anyone covering for someone else this month</strong> — new to the property, new
            to the chart of accounts, and still on the hook for owner-ready commentary by the
            deadline.
          </li>
        </ul>
      </section>

      <section>
        <h3>What it solves</h3>
        <p>
          Variance narratives are one of the most repetitive, highest-stakes writing tasks in
          property management reporting. They're repetitive because you do them every month for
          every property. They're high-stakes because owners read them closely, and a vague or wrong
          explanation erodes trust fast.
        </p>
        <p>
          The usual approach is manual: pull the variance report, open the GL, trace the line item,
          write a sentence, repeat — for every material variance, every property, every month. It's
          slow, it's easy to get inconsistent across properties or team members, and it's easy to
          write something that sounds right but doesn't actually match what happened in the ledger.
        </p>
        <p>
          VNG collapses that process. You bring the variance data; it drafts narratives directly
          from the GL transactions that drove each variance. You're not starting from a blank page
          or trusting a summary — you're reviewing and refining commentary that's already anchored
          to the source data. What used to take an afternoon of tracing and writing typically takes
          a fraction of that, and the narrative is defensible because it's built from the actual
          transaction detail, not inferred from a general sense of the account.
        </p>
      </section>

      <section>
        <h3>Features</h3>
        <ul>
          <li>
            <strong>GL-grounded narrative drafting.</strong> Narratives are generated from the
            transactions that make up the variance, not a generic template — so “increased due to
            timing of janitorial invoice” is a statement VNG can actually back up, not a guess.
          </li>
          <li>
            <strong>Materiality-aware output.</strong> VNG focuses commentary on variances that
            clear a materiality threshold, so you're not writing three sentences to explain a $40
            rounding difference.
          </li>
          <li>
            <strong>Owner-ready tone out of the box.</strong> Drafts read like something a PM would
            actually send an owner — direct, specific, no filler — so editing is fast rather than a
            full rewrite.
          </li>
          <li>
            <strong>Transparent sourcing.</strong> Every narrative can be traced back to the
            underlying GL lines it was drawn from, which matters when an owner or asset manager asks
            “how do you know that.”
          </li>
          <li>
            <strong>Built for the monthly cadence.</strong> Designed around the reality of a
            recurring reporting cycle, not a one-off analysis — bring this month's numbers, get this
            month's narratives.
          </li>
        </ul>
      </section>

      <section>
        <h3>How it works</h3>
        <ol>
          <li>
            <strong>Bring your variance data.</strong> Upload or paste your budget-vs-actual GL
            export — the same variance report you'd normally work from line by line.
          </li>
          <li>
            <strong>VNG matches variances to the transactions behind them.</strong> It identifies
            the material variances, pulls the underlying GL detail for each one, and drafts a
            narrative grounded in what actually happened in the ledger — not a generic explanation
            of what a variance “usually” means.
          </li>
          <li>
            <strong>You review, adjust, and export.</strong> Read through the drafted narratives,
            tighten anything that needs your judgment (a lease event, a one-time capital item,
            context only you know), and export commentary that's ready to sit next to your income
            statement.
          </li>
        </ol>
        <p>
          Typical input: a monthly GL variance export with budget and actual columns by account.
          Typical output: a narrative for each material variance, written in owner-facing language
          and traceable back to the transactions that generated it.
        </p>
      </section>

      <section>
        <h3>Real use-case example</h3>
        <p><strong>Input</strong> (anonymized GL variance excerpt):</p>
        <div className="home-landing-table">
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th>Budget</th>
                <th>Actual</th>
                <th>Variance</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Repairs &amp; Maintenance — HVAC</td>
                <td>$4,200</td>
                <td>$11,850</td>
                <td>+$7,650 (182%)</td>
              </tr>
              <tr>
                <td>Janitorial Services</td>
                <td>$8,500</td>
                <td>$6,100</td>
                <td>-$2,400 (-28%)</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p><strong>VNG-drafted narrative:</strong></p>
        <blockquote>
          <p>
            <em>
              Repairs &amp; Maintenance — HVAC came in $7,650 over budget due to an unplanned
              compressor repair on the rooftop unit serving the 4th floor, invoiced mid-month. This
              was a one-time repair, not a recurring cost increase.
            </em>
          </p>
          <p>
            <em>
              Janitorial Services came in $2,400 under budget because the March invoice was received
              after month-end close and will post in the following period; year-to-date janitorial
              spend remains on track with budget.
            </em>
          </p>
        </blockquote>
        <p>
          Both narratives are pulled directly from the GL detail underneath the variance line — the
          invoice date, the vendor, the account activity — not inferred from the size of the number
          alone.
        </p>
      </section>

      <section>
        <h3>FAQ</h3>
        <dl className="home-landing-faq">
          <dt>Does VNG make up numbers or just explain them?</dt>
          <dd>
            VNG doesn't touch or alter your figures — it reads the GL detail behind a variance and
            drafts language to explain it. The numbers in your report come from your source data,
            exactly as reported.
          </dd>

          <dt>What counts as a “material” variance?</dt>
          <dd>
            You can set the materiality threshold — a dollar amount, a percentage, or both — so VNG
            focuses on the variances that actually warrant commentary instead of narrating every
            account.
          </dd>

          <dt>Can I edit the narratives before sending them?</dt>
          <dd>
            Yes, and you should. VNG produces a strong first draft grounded in real transaction
            data, but you still bring the judgment calls only a PM on the ground would know — a
            tenant conversation, a planned capital project, context that isn't in the GL.
          </dd>

          <dt>What GL formats does VNG accept?</dt>
          <dd>
            VNG is built to work with standard budget-vs-actual GL exports. If your export format
            doesn't parse cleanly, that's worth flagging — the goal is to handle real-world exports,
            not a single idealized format.
          </dd>

          <dt>Is this still labeled a prototype?</dt>
          <dd>
            No — VNG is a stable, production tool in active use. It's not a proof-of-concept; it's
            built to be part of your actual monthly reporting workflow.
          </dd>

          <dt>Who built this and why should I trust it?</dt>
          <dd>
            VNG was built by a practicing CRE General Manager who writes variance narratives as part
            of the job, not a software vendor guessing at the workflow.
          </dd>
        </dl>
      </section>

      <section className="home-landing-cta-block">
        <h3>
          Stop writing the same variance explanation three different ways across three different
          properties.
        </h3>
        <a className="home-landing-cta" href="/vng">Try VNG Now →</a>
      </section>

      {/* Internal links so the static /tools/* landing pages aren't orphaned —
          they carry each proxied tool's meta/JSON-LD, which the proxied app
          itself can't serve from this repo. */}
      <nav className="home-landing-links">
        <span>More on the tools:</span>
        <a href="/tools/orgen">Owner Report Generator</a>
        <a href="/tools/downdriller">GL Down Driller</a>
        <a href="/tools/chiefeoinspector">ChiefEO Inspector</a>
      </nav>
    </div>
  )
}
