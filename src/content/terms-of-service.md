# Terms of Service

**ChiefEO** (operated by Golden Real Estate Ventures and Exchanges LLC)

**Effective Date:** August 1, 2026  
**Last Updated:** July 28, 2026

---

## 1. ACCEPTANCE OF TERMS

By accessing or using any ChiefEO product or service (including but not limited to chiefeotool.com, the VNG, Owner Report Generator, GL Down Driller, ChiefEO Inspector, and ChiefEO Next), you agree to be bound by these Terms of Service. If you do not agree to these terms, do not use the services.

---

## 2. SERVICES DESCRIPTION

ChiefEO provides software tools and applications designed to assist commercial real estate professionals with property management, financial analysis, and task prioritization. Our services include:

- **Variance Narrative Generator (VNG)** — Converts income statement variance data into written narratives
- **Owner Report Generator** — Compiles owner-ready PDF reports from financial data and templates
- **GL Down Driller** — Analyzes general ledger exports and variance data
- **ChiefEO Inspector** — Property inspection documentation and reporting tool
- **ChiefEO Next** — Task prioritization and project management application

Services are provided "as-is" and may be used for business purposes only.

---

## 3. AI DISCLOSURE & LIMITATIONS

**3.1 AI-Assisted Content**

The following services use artificial intelligence (Claude API, Anthropic) to generate or assist with content:

- Variance Narrative Generator — generates narrative text from financial data
- Owner Report Generator — generates variance commentary and report narratives
- ChiefEO Inspector — uses AI-assisted dictation and area scan analysis

**Users must review all AI-generated content for accuracy before relying on it for business decisions, regulatory filings, or client communication.**

**3.2 Accuracy Disclaimer**

AI outputs can contain errors, inaccuracies, hallucinations, or misinterpretations. ChiefEO does not warrant that:
- Generated narratives accurately reflect underlying financial data
- Extracted or categorized data is free from errors
- Suggested text or analysis is suitable for your specific property or circumstances
- AI outputs meet any regulatory, accounting, or legal standard

**You are solely responsible for verifying all outputs against source documents and original data before use.**

**3.3 Non-AI Processing**

GL Down Driller, Owner Report Generator (numerical extraction/compilation), and ChiefEO Next use deterministic, rule-based logic for data extraction and calculation. These outputs are deterministic but should still be verified.

---

## 4. NOT PROFESSIONAL ADVICE

**4.1 No Accounting, Legal, or Tax Advice**

ChiefEO tools do not provide accounting, legal, tax, or professional advice. Services are for informational purposes only and are not a substitute for:
- Consultation with a licensed Certified Public Accountant (CPA)
- Review by a licensed attorney
- Guidance from a tax professional
- Professional property management or real estate advice

**If your business decision relies on output from a ChiefEO tool, you must have the output reviewed by a qualified professional before acting on it.**

**4.2 Licensed Services Disclamer**

ChiefEO does not hold licenses as a CPA firm, law firm, tax advisory firm, or property management company. Tools are built by a commercial real estate practitioner for informational use; they do not constitute the provision of licensed professional services.

---

## 5. DATA SECURITY & THIRD-PARTY DISCLOSURE

### Client-Side Tools (VNG, Owner Report Generator, GL Down Driller)

**5.1 Local Storage Only**

VNG, Owner Report Generator, and GL Down Driller process all data in your browser using localStorage. Specifically:
- Your financial data, GL exports, and generated reports are stored only on your device
- No data is transmitted to ChiefEO servers
- No data is retained on any server once you close your browser or clear your cache
- You are solely responsible for securing your device and browser

**To delete your data from these tools: Clear your browser's cache and localStorage, or use your browser's built-in "Clear Browsing Data" function.**

**5.2 Claude API (VNG, Owner Report Generator Narratives, Inspector)**

VNG, Owner Report Generator (narrative generation only), and ChiefEO Inspector send text content to Anthropic's Claude API for processing. Specifically:
- Financial data, inspection notes, or text you input may be transmitted to Anthropic servers
- Anthropic's API terms apply: https://www.anthropic.com/legal/consumer-terms
- Anthropic does not retain API inputs for model training (unless you separately opt in via Anthropic's settings)

**⚠️ IMPORTANT: Do not include in Claude API inputs:**
- Personally Identifiable Information (PII): social security numbers, passport numbers, driver's license numbers
- Sensitive credentials: passwords, API keys, access tokens
- Confidential client data: tenant names, financial details, or information marked confidential
- Any data you are not permitted to share with third parties

**By using these services, you consent to transmission of your inputs to Anthropic for AI processing.**

### Server-Based Tools (ChiefEO Next, Inspector Feedback)

**5.3 Supabase Backend (ChiefEO Next)**

ChiefEO Next uses Supabase for authentication, data storage, and task management. Supabase's privacy policy applies: https://supabase.com/privacy

- Your account data (email, authentication tokens) is stored in Supabase PostgreSQL
- All task data, projects, and project history in ChiefEO Next is stored in Supabase
- Supabase enforces Row-Level Security (RLS) so you can only access your own data
- Backup and audit data is retained for 12 months after account deletion, then permanently purged

**5.4 ChiefEO Inspector Feedback (Optional)**

If you choose to submit feedback via ChiefEO Inspector, your feedback text is stored temporarily for support purposes only. This is not mandatory; feedback is entirely optional.

**5.5 Breach Notification**

In the event of a data breach affecting ChiefEO Next or stored Inspector feedback:
- ChiefEO will notify you via email to your registered account address within 30 days of discovery
- You have the right to request a detailed incident report
- Contact: support@chiefeotool.com

**5.6 Data Access & Audit (ChiefEO Next Only)**

For ChiefEO Next, you have the right to:
- Export your data in standard formats (CSV, JSON) at any time
- Request a complete data audit showing what ChiefEO holds about you (response within 30 days)
- Request correction or deletion of inaccurate data
- Contact: support@chiefeotool.com

---

## 6. DATA OWNERSHIP & USER RIGHTS

**6.1 Your Data Ownership**

You retain full ownership of:
- All financial data, property information, and documents you input into any ChiefEO tool
- All reports, narratives, and outputs generated by ChiefEO tools from your data
- All task data and project information in ChiefEO Next

**This applies whether data is stored locally on your device (VNG, Owner Report, GL Down Driller) or in Supabase (ChiefEO Next).**

**6.2 ChiefEO's License to Your Data**

For tools that retain data (ChiefEO Next only), you grant ChiefEO a non-exclusive license to:
- Process your data to provide the services
- Store your data to maintain your account and service continuity
- Aggregate anonymized, de-identified data for product improvement (never linked to your identity or property)

**For client-side tools (VNG, Owner Report, GL Down Driller), ChiefEO has no access to or license to your data, since it is never transmitted.**

**ChiefEO does not claim ownership of, nor will it reuse, republish, or claim credit for outputs you generate.**

**6.3 Your License to Use Outputs**

You may:
- Use generated reports and narratives for business purposes (internal use, client sharing, lending)
- Share reports with colleagues, clients, lenders, and stakeholders
- Reproduce and modify outputs for your own use
- Store and archive outputs

You may not:
- Misrepresent ChiefEO outputs as independent professional analysis without disclosing they are AI-assisted (where applicable)
- Sell ChiefEO-generated outputs as part of a commercial service competing with ChiefEO
- License or sublicense ChiefEO tools to third parties

---

## 7. ACCEPTABLE USE POLICY

You agree not to use ChiefEO services to:

1. **Reverse-engineer or scrape** — Attempt to reverse-engineer, decompile, or extract source code; scrape data from other users
2. **Illegal purposes** — Use for money laundering, fraud, sanctions evasion, or other illegal activity
3. **Abuse infrastructure** — Perform denial-of-service attacks, spam, or resource exhaustion
4. **Misrepresent outputs** — Claim ChiefEO narratives are independent professional analysis without disclosure that they are AI-assisted
5. **Competitive services** — Aggregate ChiefEO outputs and resell them as your own service
6. **Violate third-party rights** — Infringe intellectual property, violate confidentiality, or violate another party's rights by using ChiefEO tools
7. **Violate regulations** — Use tools to facilitate regulatory violations (e.g., manipulating financial records for false SEC filings)

**Violation of this policy may result in suspension or termination of your account without refund.**

---

## 8. LIMITATION OF LIABILITY

**8.1 Disclaimer of Warranties**

ChiefEO services are provided "AS-IS" and "AS AVAILABLE." ChiefEO disclaims all warranties, express or implied, including merchantability, fitness for a particular purpose, and non-infringement.

**ChiefEO does not warrant:**
- That services will be uninterrupted or error-free
- That any defects will be corrected
- That outputs will be accurate, complete, or suitable for your use
- That services comply with all laws applicable to your jurisdiction or industry

**8.2 Liability Cap**

**Except for claims arising from your violation of these Terms or infringement of ChiefEO's intellectual property, ChiefEO's total liability to you shall not exceed the lesser of:**
- **(a) Fees you paid ChiefEO in the 12 months prior to the claim, or**
- **(b) $500 USD**

**This cap applies to all claims: contract, tort, negligence, strict liability, or otherwise.**

**8.3 No Liability for Indirect Damages**

**In no event shall ChiefEO be liable for:**
- Lost profits, lost revenue, lost business opportunity, or lost data
- Indirect, incidental, consequential, special, or punitive damages
- Damages arising from your business decisions made based on ChiefEO outputs
- Damages from service interruption, data loss, or security breaches (except where ChiefEO's gross negligence is proven)

**This applies even if ChiefEO has been advised of the possibility of such damages.**

**8.4 Third-Party Services**

ChiefEO is not liable for:
- Anthropic Claude API errors, downtime, or data handling practices
- Supabase outages, data breaches, or policy changes
- Vercel hosting failures or data loss
- Any third-party service used to operate ChiefEO

**You agree to pursue remedies directly with those third parties if applicable.**

---

## 9. INDEMNIFICATION

You agree to indemnify, defend, and hold harmless ChiefEO, its founders, employees, and agents from any claims, damages, losses, or expenses (including legal fees) arising from:

1. Your violation of these Terms
2. Your misuse of ChiefEO services
3. Your unauthorized use of ChiefEO outputs (e.g., misrepresenting AI content as independent analysis)
4. Business decisions you made based on ChiefEO outputs without verifying them
5. Your infringement of third-party intellectual property or rights while using ChiefEO services
6. Claims by third parties (tenants, lenders, regulators, etc.) based on reports or analysis generated using ChiefEO tools

---

## 10. RESOLUTION & ARBITRATION

**10.1 Informal Resolution**

Before pursuing formal legal action, you and ChiefEO agree to attempt informal resolution through good-faith discussion. Contact: support@chiefeotool.com

**10.2 Arbitration (Optional)**

If informal resolution fails, either party may initiate binding arbitration under JAMS (Judicial Arbitration and Mediation Services) rules, to be held in San Francisco, California.

- **Both parties have the right to opt out of arbitration and pursue litigation instead.**
- To opt out, notify ChiefEO in writing within 30 days of the first dispute notice.
- If you do not opt out, disputes are resolved by a single arbitrator in arbitration, not court.
- Arbitration is final and binding, with limited appeal rights.
- Each party pays its own attorney fees unless the arbitrator awards them.

**10.3 Exceptions to Arbitration**

Arbitration does not apply to:
- Claims arising from intellectual property infringement
- Claims for injunctive relief (e.g., preventing service termination)
- Small claims court actions (if permitted by your state)

---

## 11. GOVERNING LAW & JURISDICTION

These Terms are governed by the laws of the State of California, without regard to conflict-of-law principles. 

If arbitration does not apply or is waived, both parties consent to the exclusive jurisdiction of the state and federal courts located in San Francisco, California.

---

## 12. ACCESSIBILITY

ChiefEO is committed to accessibility for all users. Current status:

- **Owner Report Generator** — Targeted compliance with WCAG 2.1 AA (accessibility audit in progress)
- **GL Down Driller** — WCAG 2.1 A compliant
- **ChiefEO Inspector** — Accessibility improvements in development
- **ChiefEO Next** — WCAG 2.1 A targeted

If you experience accessibility barriers, contact: support@chiefeotool.com

---

## 13. SERVICE AVAILABILITY & BACKUP

**13.1 No Uptime Guarantee**

ChiefEO services are provided without guaranteed uptime or availability. Services may be interrupted for maintenance, updates, or unforeseen technical issues.

**ChiefEO is not liable for:**
- Service outages or downtime
- Data loss resulting from service interruption
- Business losses due to unavailable services

**13.2 User Responsibility for Backup**

**You are solely responsible for backing up your data.** You should:
- Regularly export data from ChiefEO Next in standard formats (CSV, JSON)
- Maintain local copies of reports and outputs
- Not rely exclusively on ChiefEO for data preservation

**13.3 Data Retention After Account Deletion (ChiefEO Next Only)**

When you delete your ChiefEO Next account:
- Active data is marked for deletion immediately
- Data is permanently purged after 30 days to allow account recovery
- Backups and audit logs may be retained for 12 months for legal compliance and security

**For client-side tools (VNG, Owner Report, GL Down Driller), data is stored only on your device and not subject to ChiefEO's retention policies.**

---

## 14. LIMITATION ON PROFESSIONAL CREDENTIALS

The ChiefEO product suite is built by a commercial real estate practitioner with 10+ years of experience. However:

- ChiefEO is not a licensed accounting firm, law firm, tax advisory firm, or property management company
- Outputs should not be cited as professional analysis or expert opinion without external professional review
- No assertion of specialized expertise beyond the practitioner's own experience

---

## 15. EXPORT CONTROLS

ChiefEO services rely on the Anthropic Claude API for AI features. Claude API access is subject to U.S. export control regulations.

**If you are accessing ChiefEO from, or on behalf of persons or entities in, sanctioned countries (e.g., Iran, North Korea, Syria, Crimea), or if you are subject to U.S. export restrictions, you are prohibited from using ChiefEO services.**

By using ChiefEO, you represent that you are not subject to U.S. export restrictions and will not use services in violation of export control law.

---

## 16. DATA DELETION & USER CONTROL

**16.1 Client-Side Tools (VNG, Owner Report Generator, GL Down Driller)**

These tools store all data locally on your device only. To delete your data:
- **Option 1:** Clear your browser's cache and localStorage manually via your browser settings
- **Option 2:** Use your browser's "Clear Browsing Data" function (Settings > Privacy > Clear Browsing Data)
- **Option 3:** Close your browser; data may expire from localStorage based on your browser's settings

**ChiefEO has no server-side data to delete on your behalf.**

**16.2 ChiefEO Next Account Deletion**

You can request permanent account deletion at any time. Upon deletion:
- Your account and all active task data are marked for removal immediately
- Data is purged after 30 days (during which you can request account recovery)
- Backup and audit logs are retained for 12 months for legal and security purposes, then destroyed

Contact: support@chiefeotool.com

**16.3 ChiefEO Next Data Export**

You can export your ChiefEO Next data at any time in standard formats:
- CSV (comma-separated task export)
- JSON (full project and task history)

Export your data via your account settings in ChiefEO Next, or request assistance: support@chiefeotool.com

**16.4 Right to Access (ChiefEO Next Only)**

For ChiefEO Next, you have the right to request a complete inventory of data ChiefEO holds about you, including:
- Account profile information (email, authentication data)
- All stored task and project data
- Audit logs and activity history

Request within 30 days. Contact: support@chiefeotool.com

---

## 17. MODIFICATIONS & DISCONTINUATION

**17.1 Right to Modify**

ChiefEO reserves the right to:
- Modify, add, or remove features
- Change pricing and payment terms (with 30 days notice for paid services)
- Update these Terms of Service (changes are effective 30 days after notice)

**17.2 Discontinuation of Services**

If ChiefEO discontinues a service:
- Users will receive 60 days notice via email
- You will have access to export all data during this period
- No refunds for pre-paid periods (except as required by law)

**17.3 Material Breach**

If you materially breach these Terms (e.g., reverse-engineer code, use tools for illegal purposes, misrepresent outputs as professional analysis), ChiefEO may:
- Suspend your account immediately
- Terminate your account without refund
- Pursue legal remedies

---

## 18. ENTIRE AGREEMENT & SEVERABILITY

**18.1 Entire Agreement**

These Terms, along with ChiefEO's Privacy Policy, constitute the entire agreement between you and ChiefEO regarding the services. No other statements, promises, or agreements apply unless in writing and signed by both parties.

**18.2 Severability**

If any provision of these Terms is found to be unenforceable or invalid, that provision is severed, and the remaining provisions remain in full force.

**18.3 No Waiver**

ChiefEO's failure to enforce any right or provision does not constitute a waiver of that right or provision.

---

## 19. CONTACT

For questions about these Terms, or to exercise your rights under these Terms, contact:

**ChiefEO Support**  
Golden Real Estate Ventures and Exchanges LLC  
Email: support@chiefeotool.com

---

## 20. SCHEDULE: TOOL-SPECIFIC NOTES

### VNG (Variance Narrative Generator)
- **AI-assisted:** Yes (Claude generates narratives from GL variance data)
- **Data storage:** All data stored locally on your device (localStorage); not transmitted to ChiefEO servers
- **Third-party transmission:** Financial variance data is transmitted to Anthropic Claude API for narrative generation
- **Professional review required:** Yes (output is AI-assisted narrative interpretation, not verified fact; you must review before use)
- **Materiality rule:** AND logic ($15k AND 15%, $5k floor)
- **Data deletion:** Clear your browser cache to delete

### Owner Report Generator
- **AI-assisted:** Partial (Claude generates narratives; numerical extraction and PDF compilation are deterministic)
- **Data storage:** All data stored locally on your device (localStorage); not transmitted to ChiefEO servers
- **Third-party transmission:** Narrative text is transmitted to Anthropic Claude API for commentary generation
- **Professional review required:** Yes (before sending to owner or stakeholders)
- **Key requirement:** Prior section must be complete before compilation (required-section checklist)
- **Data deletion:** Clear your browser cache to delete

### GL Down Driller
- **AI-assisted:** No (deterministic GL parsing, categorization, and reconciliation)
- **Data storage:** All processing in-browser; GL data never leaves your device
- **Third-party transmission:** None
- **Professional review required:** Recommended (for GL account accuracy verification)
- **Auto-detection:** Handles QuickBooks, MRI, Yardi, Sage, and CSV exports (semicolon/BOM)
- **Data deletion:** Clear your browser cache to delete

### ChiefEO Inspector
- **AI-assisted:** Yes (voice dictation, area scan analysis, and report drafting via Claude)
- **Data storage:** Inspection notes and photos stored locally on your device
- **Third-party transmission:** Inspection notes and analysis requests are transmitted to Anthropic Claude API
- **Professional review required:** Yes (outputs are AI-assisted, not professional property inspections)
- **Feedback (optional):** If you submit optional feedback, it is stored temporarily for support purposes only
- **Key feature:** Push-to-talk voice input, saved inspection history (IndexedDB)
- **Data deletion:** Clear your browser cache and IndexedDB to delete

### ChiefEO Next
- **AI-assisted:** No (deterministic task prioritization and scoring algorithm)
- **Data storage:** Task data, projects, and account information stored in Supabase (server-side) with Row-Level Security
- **Third-party transmission:** Supabase (authentication and data storage); no external AI services
- **Paid service:** Yes (lifetime Pro tier planned)
- **Data ownership:** You own all task and project data; ChiefEO cannot reuse or republish
- **Data deletion:** Request account deletion via support@chiefeotool.com; data purged after 30 days
- **Data export:** Export task data as CSV or JSON from your account settings
- **Key feature:** Task-prioritization algorithm; progress tracking; analytics dashboard

---

**© 2026 Golden Real Estate Ventures and Exchanges LLC. ChiefEO™ and ChiefEO Next™ are trademarks of Golden Real Estate Ventures and Exchanges LLC. All rights reserved.**
