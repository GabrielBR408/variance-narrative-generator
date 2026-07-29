# Privacy Policy

**ChiefEO** (operated by Golden Real Estate Ventures and Exchanges LLC)

**Effective Date:** August 1, 2026  
**Last Updated:** July 28, 2026

---

## 1. INTRODUCTION

ChiefEO ("we," "us," "our," or "Company") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our website and applications.

**Please read this Privacy Policy carefully.** If you do not agree with our policies and practices, please do not use our services.

This Privacy Policy applies to:
- **chiefeotool.com** — the ChiefEO hub website
- **VNG (Variance Narrative Generator)**
- **Owner Report Generator**
- **GL Down Driller**
- **ChiefEO Inspector**
- **ChiefEO Next** — the task prioritization application

---

## 2. INFORMATION WE COLLECT

### 2.1 Client-Side Tools (VNG, Owner Report, GL Down Driller, Inspector)

**What we collect:** We do not collect, store, or have access to any of your data.

**Where data is stored:** All data you input into these tools is stored only on your device, in your browser's localStorage or IndexedDB. This data never leaves your device.

**Third-party transmission:** 
- VNG, Owner Report Generator (narrative only), and Inspector transmit text to Anthropic's Claude API for AI processing
- The text you submit for processing may include financial data, property information, or inspection notes
- Anthropic's privacy policy applies to this transmission: https://www.anthropic.com/legal/consumer-terms
- Anthropic does not retain your API inputs for model training (unless you separately opt in)

**What you should NOT input:** Do not include in your inputs to Claude API:
- Social Security Numbers, passport numbers, or driver's licenses
- Passwords, API keys, or access tokens
- Tenant names or confidential client data
- Any information you are not authorized to share with third parties

**Data we do NOT collect for these tools:**
- ❌ No account information (email, name, location)
- ❌ No cookies or tracking pixels
- ❌ No analytics about your usage
- ❌ No error logs or crash reports
- ❌ No personal identifiers

### 2.2 ChiefEO Next (Server-Based Task App)

**What we collect when you sign up:**
- Email address (used for authentication only)
- Authentication tokens (managed by Supabase)

**What we collect when you use ChiefEO Next:**
- All task data you create (task title, description, priority, status, due date, notes)
- All project data you create (project name, description, settings)
- Audit logs of your account activity (login times, data modifications, soft-deletes)
- Your account preferences and settings

**Where data is stored:** All data is stored in Supabase (a PostgreSQL database). Supabase's privacy policy applies: https://supabase.com/privacy

**Row-Level Security (RLS):**
- Supabase uses Row-Level Security to ensure you can only access your own data
- No other user can access your tasks, projects, or account information
- ChiefEO staff cannot access your data without explicit authorization from you

**What we do NOT collect:**
- ❌ No location data or IP address logging
- ❌ No cookies or tracking pixels
- ❌ No third-party analytics or advertising trackers
- ❌ No payment information (this is a free or subscription-based service, handled separately)

### 2.3 Inspector Feedback (Optional)

If you choose to submit optional feedback via ChiefEO Inspector:
- Your feedback text is stored temporarily for support purposes
- No identifying information is linked to your feedback (unless you voluntarily include it)
- Feedback is reviewed by ChiefEO staff to improve the app
- Feedback is not sold, shared, or used for marketing

**Feedback submission is entirely optional and not required to use Inspector.**

### 2.4 Cookies and Tracking

**We do NOT use:**
- ❌ Third-party cookies
- ❌ Tracking pixels or web beacons
- ❌ Google Analytics or similar analytics providers
- ❌ Advertising networks or retargeting
- ❌ Session cookies (except for ChiefEO Next authentication)

**We DO use (ChiefEO Next only):**
- ✅ Authentication session tokens (to keep you logged in)
- ✅ These tokens are managed by Supabase and expire after a set period

---

## 3. HOW WE USE YOUR INFORMATION

### 3.1 Client-Side Tools (VNG, Owner Report, GL Down Driller, Inspector)

Since we do not collect data from these tools, we do not use your information. Your data remains entirely under your control.

**The only exception:** If you submit optional feedback, we use it to:
- Improve app features and user experience
- Fix bugs and technical issues
- Understand how practitioners use the tools

### 3.2 ChiefEO Next

We use your information to:
- **Provide the service:** Store and manage your tasks, projects, and priorities
- **Authentication:** Verify your identity and keep you logged in
- **Compliance & Legal:** Maintain audit logs to meet legal and contractual obligations
- **Service improvement:** Analyze anonymized, de-identified usage patterns (e.g., "80% of users add tasks via mobile")

**We do NOT use your information to:**
- ❌ Sell or share your data with third parties
- ❌ Create marketing profiles or segments
- ❌ Train machine learning models on your data
- ❌ Serve you targeted advertising

---

## 4. THIRD-PARTY SERVICES & APIS

### 4.1 Anthropic Claude API

**What happens:** VNG, Owner Report Generator (narrative generation), and ChiefEO Inspector send text to Anthropic's Claude API.

**What Anthropic receives:**
- The text you input (financial data, inspection notes, variance explanations, etc.)
- Does NOT include: your email, identity, account information, or IP address

**Anthropic's commitments:**
- Anthropic does not retain API inputs for model training (API calls are not used to improve their models)
- Anthropic's API privacy policy applies: https://www.anthropic.com/legal/consumer-terms
- You can review Anthropic's terms directly for full details

**What you can do:**
- Opt out of these tools entirely and use ChiefEO Next (which does not use Claude)
- Use client-side tools only for non-sensitive data
- Do not include PII, credentials, or confidential information in your inputs

### 4.2 Supabase

**What happens:** ChiefEO Next stores all task and account data in Supabase's managed PostgreSQL database.

**What Supabase receives:**
- Your email address
- All task and project data you create
- Audit logs of your account activity
- Authentication credentials (managed securely by Supabase)

**Supabase's commitments:**
- Row-Level Security (RLS) prevents other users from accessing your data
- Supabase's privacy policy applies: https://supabase.com/privacy
- Supabase complies with GDPR and SOC 2 standards
- Data is encrypted in transit and can be encrypted at rest (reviewed per Supabase's standards)

**What Supabase does NOT do:**
- ❌ Does not sell your data
- ❌ Does not use your data for advertising or marketing
- ❌ Does not share your data with third parties (except as required by law)

### 4.3 Vercel (Hosting)

ChiefEO tools and ChiefEO Next are hosted on Vercel. Vercel has access to basic hosting logs (IP address, request timestamps, performance data) to operate the service.

**Vercel's privacy policy:** https://vercel.com/legal/privacy-policy

---

## 5. DATA RETENTION & DELETION

### 5.1 Client-Side Tools (VNG, Owner Report, GL Down Driller, Inspector)

**Your data is stored on your device only.**

To delete your data:
- **Option 1:** Clear your browser's cache and localStorage (Settings > Privacy > Clear Browsing Data)
- **Option 2:** For Inspector: Clear your browser's IndexedDB as well
- **Option 3:** Uninstall and reinstall your browser

**ChiefEO has no copies of your data to delete.**

### 5.2 ChiefEO Next

**Active data retention:**
- All task and project data is retained as long as your account is active
- You can export your data at any time as CSV or JSON

**After account deletion:**
- Active data is marked for deletion immediately
- Data is permanently purged from Supabase after 30 days
- During the 30-day window, you can request account recovery and your data will be restored
- After 30 days, data is permanently deleted and cannot be recovered

**Backup and audit logs:**
- Backup copies and audit logs are retained for 12 months after account deletion
- After 12 months, all backup and audit data is permanently destroyed

**How to request deletion:**
- Contact: support@chiefeotool.com
- Provide: Your account email
- Confirmation: You will receive a confirmation email once deletion is initiated

### 5.3 Inspector Feedback

Optional feedback is retained for:
- **30 days** — for initial review and bug fixing
- **After 30 days** — feedback is archived or deleted at ChiefEO's discretion

Feedback is not sold, shared, or retained for purposes other than service improvement.

---

## 6. DATA SECURITY

### 6.1 Client-Side Tools

Since data is stored only on your device, security is your responsibility:
- Keep your device secure (password-protected, up-to-date OS and browser)
- Use a reputable antivirus solution
- Do not input sensitive data on untrusted devices
- Clear your browser's cache if sharing a device

**ChiefEO is not responsible for data security on your device.**

### 6.2 ChiefEO Next & Supabase

**Supabase provides:**
- ✅ HTTPS encryption for all data in transit
- ✅ PostgreSQL encryption standards for data at rest
- ✅ Row-Level Security (RLS) to prevent unauthorized access
- ✅ Regular security audits and penetration testing
- ✅ SOC 2 Type II compliance

**ChiefEO commitments:**
- We do not store passwords (Supabase handles authentication securely)
- We do not log sensitive data to error reports
- We limit access to your data to authorized ChiefEO staff only

### 6.3 Breach Notification

In the event of a data breach affecting ChiefEO Next:
- We will notify you via email within 30 days of discovery
- You will receive details about what was compromised
- You will have the right to request an incident report

**Contact:** support@chiefeotool.com

---

## 7. YOUR PRIVACY RIGHTS

### 7.1 Client-Side Tools (VNG, Owner Report, GL Down Driller, Inspector)

Since we do not collect or store your data:
- ✅ Your data is always under your control
- ✅ You can delete your data at any time by clearing your browser
- ✅ You do not need to request anything from us; you manage everything yourself

### 7.2 ChiefEO Next

You have the right to:

**Right to Access:**
- Request a complete copy of all data ChiefEO holds about you
- Request within 30 days will be fulfilled within 30 days
- Contact: support@chiefeotool.com

**Right to Rectification:**
- Request correction of inaccurate data in your account
- Contact: support@chiefeotool.com

**Right to Erasure ("Right to be Forgotten"):**
- Request deletion of your account and all associated data
- Data will be purged after 30 days
- Contact: support@chiefeotool.com

**Right to Data Portability:**
- Export your data in standard formats (CSV, JSON) at any time
- Use your ChiefEO Next account settings to export, or contact: support@chiefeotool.com

**Right to Object:**
- Object to certain data processing (e.g., audit logging)
- Note: Some logging is necessary for service operation and legal compliance
- Contact: support@chiefeotool.com to discuss

**Right to Withdraw Consent:**
- Withdraw consent for feedback submission at any time
- Simply do not submit feedback; it is entirely optional

### 7.3 GDPR & CCPA Compliance

**GDPR (European Economic Area residents):**
- We comply with GDPR data subject rights (access, rectification, erasure, portability)
- We do not transfer personal data outside the EEA without appropriate safeguards
- We have a Data Processing Agreement with Supabase

**CCPA (California residents):**
- We comply with CCPA consumer rights (access, deletion, opt-out of sale)
- We do not sell or share personal information with third parties
- You have the right to request a list of data we hold about you

---

## 8. CHILDREN'S PRIVACY

ChiefEO services are designed for commercial real estate professionals (adults 18+). We do not knowingly collect information from children under 13.

If we learn that we have collected information from a child under 13, we will:
- Delete such information promptly
- Notify the parent or guardian

**Parents:** If you believe ChiefEO has collected information from your child, please contact: support@chiefeotool.com

---

## 9. INTERNATIONAL USERS

ChiefEO services are operated in the United States. By using our services:
- You consent to the transfer of your information to the United States
- You acknowledge that US data protection laws may differ from your country's laws
- For EU residents: We rely on Supabase's Standard Contractual Clauses for data transfers

---

## 10. CHANGES TO THIS PRIVACY POLICY

We may update this Privacy Policy from time to time. Changes will be effective immediately upon posting.

**If material changes are made:**
- We will notify you via email (for ChiefEO Next users)
- We will post the updated policy on chiefeotool.com
- Your continued use of ChiefEO constitutes acceptance of the updated policy

**Last updated:** July 28, 2026

---

## 11. CONTACT & DATA REQUESTS

For questions about this Privacy Policy, or to exercise any of your privacy rights, contact:

**ChiefEO Privacy**  
Golden Real Estate Ventures and Exchanges LLC  
Email: support@chiefeotool.com

**Response time:** We will respond to all requests within 30 days.

**Data Subject Rights Requests (GDPR/CCPA):** Include "Data Subject Request" or "Privacy Request" in your subject line.

---

## 12. TOOL-SPECIFIC PRIVACY SUMMARY

| Tool | Data Collection | Storage | Third-Party | Your Control |
|------|-----------------|---------|-------------|--------------|
| **VNG** | No (client-side only) | Browser localStorage | Claude API (for narratives) | You delete via browser |
| **Owner Report** | No (client-side only) | Browser localStorage | Claude API (for narratives) | You delete via browser |
| **GL Down Driller** | No (client-side only) | Browser localStorage | None | You delete via browser |
| **Inspector** | No (client-side only) | Browser IndexedDB | Claude API (for analysis) | You delete via browser |
| **Inspector Feedback** | Optional text only | Temporary (30 days) | None | You submit voluntarily |
| **ChiefEO Next** | Email, tasks, projects | Supabase (server) | Supabase only | You export or request deletion |

---

## 13. ADDITIONAL RESOURCES

**Anthropic Privacy & Security:**
- https://www.anthropic.com/legal/consumer-terms
- https://www.anthropic.com/legal/privacy

**Supabase Privacy & Security:**
- https://supabase.com/privacy
- https://supabase.com/security

**Vercel Privacy:**
- https://vercel.com/legal/privacy-policy

**Your Rights (GDPR/CCPA):**
- GDPR (EU): https://gdpr-info.eu/
- CCPA (California): https://oag.ca.gov/privacy/ccpa

---

**© 2026 Golden Real Estate Ventures and Exchanges LLC. ChiefEO™ and ChiefEO Next™ are trademarks of Golden Real Estate Ventures and Exchanges LLC. All rights reserved.**
