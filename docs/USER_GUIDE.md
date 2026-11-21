# DRR Report Builder: user guide

Each month this turns the 8 HIS Excel exports into the **DRR** and the **Sponsor-wise Revenue Report**, checks the
numbers, and keeps every month. Use **Chrome or Edge**. Your files stay on your laptop: nothing is uploaded, and the app
never stores patient names, phone numbers or addresses.

## One-time setup (about 15 minutes)

1. **Workspace**: choose a folder (for example `Documents\DRR Workspace`). Everything is saved there.
2. **Settings**: upload the two templates, `DRR Format.xlsx` and `Sponsor-wise Revenue Report.xlsx`.
3. **Sources**: drop in one month's 8 files. For each source press **Set up**, look at the columns, then **Confirm and save**.
4. **Doctors**: press **Scan loaded files** and **Add all**. Different spellings of one doctor are grouped for you.
   Names ending in “(REVIEW)” are kept apart: press **Same as …** if it is the same doctor.

## Every month

| Step | Where | What to do |
|---|---|---|
| 1 | **Run** | Drop the 8 exports. Every source should say **Ready**. |
| 2 | **Costs** | Pick the month. Enter Departmental Issues, Salary, Incentives and Professional Fee per doctor (or **Copy from** last month, or **Import from Excel**). Type your name, **Save**. |
| 3 | **Doctors** | Only if a new doctor appears: **Scan loaded files**, then add them. |
| 4 | **Run** | Press **Run**. Look through **Doctor-wise**, **Sponsor-wise**, **Checks** and **Pharmacy attribution**. |
| 5 | **Run → Checks** | Fix every **Fail**. Write a short note on every **Warning** saying why it is fine. |
| 6 | **Run** | **Save Draft** any time. When the checks are clear, **Mark Final**. |
| 7 | **Run** | **Download reports**. Both Excel files are saved in the workspace under `output\<month>\`. |

## Reading the Checks

- **Fail (red)** blocks Final. Examples: a file with a renamed column, a bill number that appears twice, an amount that
  cannot be read, a total that does not match. The message names the file and row.
- **Warning (yellow)** needs your note. Examples: a doctor name that is not in the list, pharmacy sales with no matching
  consultation, bills dated outside the month, a doctor whose revenue moved by more than 50%.
- **Passed (green)** lists what was looked at. Nothing is hidden: every row that was not used is counted with its reason
  under **Rows that were not used**.

## When something looks wrong

- **A source says Flagged**: the file does not match its saved mapping (usually a renamed column). The message names the
  column. Fix it on **Sources**; nothing is read from a flagged file.
- **A name shows as “Unmatched doctor”**: add or merge it on **Doctors**, then run again.
- **A month is Final but needs a correction**: load the files and run again. The new run needs a reason; the Final run is
  kept untouched.
- **Numbers look different from last month**: open **Months → Compare** to see the change per doctor.

## Looking back

**Months** lists every saved month with its totals, and can download its reports again. **Compare** puts two months side by
side; **Trend** draws the last 12 months. **Dashboards** has ready-made views (start with *Monthly Review*) and lets you
build your own tiles.

## Look after your data

- **Workspace → Back up** every month and keep the zip somewhere safe. **Restore from backup** asks before it writes.
- Never put the real exports in email, chat or a public place. They are patient data.
- Do not edit files inside the workspace folder by hand.
