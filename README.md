# DRR Report Builder

A small browser app for the finance team at G2 Health Care. Each month it turns the 8 Excel exports from the
hospital system (HIS) into two reports:

- **DRR**: the Doctor-wise Revenue Report
- **Sponsor-wise Revenue Report**

It checks the numbers, keeps every month for comparison, and fills your own Excel templates, so the formatting and
formulas stay exactly as you made them.

**Your files stay on your laptop.** Everything runs in the browser. Nothing is uploaded, there is no server and no
login. The app never stores patient names, phone numbers or addresses.

## You need

- **Chrome or Edge** on a laptop or desktop. Other browsers (Firefox, Safari, phones) cannot save into a folder
  and show a message asking you to switch.
- The 8 monthly HIS exports, and the two report templates (`DRR Format.xlsx` and `Sponsor-wise Revenue Report.xlsx`).

## First-time setup (once)

1. Open the app and go to **Workspace**. Choose (or create) a folder, for example `Documents\DRR Workspace`. Settings,
   monthly data and reports are saved there. Pick a folder that is backed up.
2. **Settings**: upload the two report templates. A file that does not fit is refused with a reason.
3. **Sources**: drop the 8 Excel files. Each is recognised by its name and columns. Press **Set up** on each source,
   check the columns, and **Confirm and save**. The suggested columns are right for the October 2026 exports.
4. **Doctors**: press **Scan loaded files**, look at the suggested doctors, and **Add all** (or add them one by one).
   Spellings like `Dr. A Kumar`, ` dr a kumar` and `A.KUMAR` are grouped as one doctor.
5. **Costs**: enter the monthly costs for each doctor (see below).

## Every month

1. **Run** page: drop this month's 8 exports. Each source should show **Ready**.
2. **Costs** page: pick the month and enter Departmental Issues, Salary, Incentives and Professional Fee per doctor.
   Use **Copy from** to start from last month, or **Import from Excel**. Type your name and **Save**.
3. **Doctors** page: if a new doctor appeared, scan and add them. A name that is not in the list is never added
   silently: it shows up in Checks.
4. **Run** page: press **Run**. Look at **Doctor-wise**, **Sponsor-wise**, **Checks** and **Pharmacy attribution**.
5. In **Checks**, a red **Fail** must be fixed (for example a file with the wrong columns, or a bill number that
   appears twice). A yellow **Warning** needs a short note saying why it is acceptable.
6. **Save Draft** as often as you like. When the checks are clear, **Mark Final**. A Final month cannot be changed.
   To correct it later, load the files and run again; the new run needs a reason.
7. **Download reports**: the two Excel files are saved in the workspace under `output\<month>\` and downloaded.

## Backup and restore

On the **Workspace** page, **Back up** downloads a zip of your settings and saved months (not the generated reports,
which can be made again). Do this regularly and keep the zip somewhere safe. **Restore from backup** shows what will
be replaced and asks you to confirm before it writes anything.

## Never commit patient data

The real exports are patient data. The folder `samples/` and every `.xlsx` outside `tests/fixtures/synthetic/` are
git-ignored, and the test files in `tests/fixtures/synthetic/` are made-up. Do not paste real data into issues, chats
or commits. See `CLAUDE.md` for the rules the app follows.

## For developers

```bash
npm ci            # install exactly what package-lock.json says
npm run dev       # run locally
npm run typecheck
npm run test      # golden tests skip themselves when samples/ is missing
npm run build     # production build in dist/
```

The brief and non-negotiable rules are in `CLAUDE.md`; the build steps are in `docs/BUILD_PROMPTS.md`.
Synthetic test files are rewritten with `npx tsx scripts/make-fixtures.ts`.

### Publishing to GitHub Pages

The app is a set of static files. `.github/workflows/deploy.yml` builds and publishes it on every push to `main`
(install, typecheck, test, build, deploy). One-time repository setup:

1. In GitHub, open the repository's **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Push to `main`. The run appears in the **Actions** tab, and the address of the site is shown in the
   `github-pages` environment (normally `https://<user>.github.io/<repository>/`).

A public repository is fine because the code holds no patient data. A private repository needs a paid GitHub plan
for Pages.
