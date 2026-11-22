# User guide

For the finance team. No technical knowledge needed.

## The idea in one minute

You do the setup **once**, for each kind of report. That setup is called a **recipe**. After that, every month is:

> open the recipe → add the Excel files → **Generate** → read the checks → download

Your Excel files are read on your own device. They are never uploaded and never saved. What is saved (in this browser)
is only your recipes and your dashboard layouts.

## First time: get the two starter recipes

1. Open the app. On **Home**, press **Add starter recipes: DRR, Sponsor-wise**.
2. Open **Generate** for the DRR. It asks for the Excel template (`DRR Format.xlsx`). Add it once. It is saved inside the
   recipe, so you will not be asked again. Use the **empty** template: if it already has names and amounts, the app
   refuses it, because they would be saved too.
3. Do the same for the Sponsor-wise report (`Sponsor-wise Revenue Report.xlsx`).

## Every month

1. **Home → Generate** on the recipe.
2. **Add this month's files.** Choose all the Excel exports at once. The app works out which file is which. The list shows
   each file the recipe needs: a green tick, or *File missing*. If a file could be two things, choose what it is. A file
   that matches nothing (for example one you do not need) is simply not used, and the checks tell you so.
3. **Check the month**, for example *Oct-2026*. It starts as last month.
4. Press **Generate**.
5. **Read the checks.**
   - **Red, "to fix"**: the report cannot be downloaded yet. For example *OP Billing: column NETAMOUNT not found*. Use
     **Fix mapping**: it opens the recipe with your new file, so you can pick the new column.
   - **Amber, "to check"**: it is made, but look. For example rows that could not be matched to a doctor, a number that
     could not be read, or a total that does not match the one at the bottom of an export. Each one says how many rows, how
     much money, and gives examples with the file and Excel row.
   - **Details**: how many rows were read, left out (such as the totals row at the bottom) and used.
6. **Download report.** The file is named `<Recipe>_<Month>.xlsx`. *Download combined data* gives every row behind the numbers.
7. *Open in dashboard* shows the report as charts, without saving anything.

## Make or change a recipe

On **Home**, *New recipe* (or *Edit*). There are five steps.

1. **Sources.** Add a sample file of each export. Each becomes a *source*. Tick the columns you need, give them a common
   name (the same name in every file stacks together), and a type (Text, Number, Money, Date). Leave out the totals row at
   the bottom with a *row filter*, for example `NOT(ISBLANK([BILLNO]))`. Press *Show combined data* to see all files stacked.
2. **Prepare.** *Clean up names*: the same doctor written in different ways becomes one name; use **Join** for names it
   cannot guess. *Look up missing values*: for example, pharmacy sales have no doctor, but the same patient's consultation
   does. The result shows how many rows matched and how many did not.
3. **Report.** Choose what each row stands for (for example Doctor, Department, Month), then the columns: row number,
   group names, **Totals** (sum, count, average…, optionally only from some sources) and **Formulas** that use other
   columns. A live preview is shown.
4. **Output.** A plain Excel sheet, or your own template. For a template, the table shows which report column goes to which
   heading, and which template formulas are kept.
5. **Test & Save.** Run it on your sample files, read the checks, then **Save**. Changes are also saved as you work.

Each step starts with a short note on what to do there, and **Next** at the bottom takes you to the next step. A red dot on
a step means something there still needs fixing.

**Formulas without typing.** Every formula box has buttons under it: **+ − × ÷** and brackets, a **Function** menu that
explains each function in plain words, and (where it helps) **Examples** built from your own columns. Below the box, the
chips list the columns you can use *in that box*. Click them to insert. Which columns appear depends on where you are:

| Formula box | Columns you can use |
| --- | --- |
| Sources → Keep a row when / Calculated columns | the file's own headings (and names you gave above) |
| Report → Total → Custom condition, Leave out rows where | the combined data (Source, Doctor, Amount…) |
| Report → Formula column | the other columns of the report |

A **Total** card also says in words what it does, for example *Adds up Amount from OP Billing and OP Consultations, for
each line of the report*.

The recipe is not finished until the list at the top of *Test & Save* is empty. A recipe that is not finished says so on Home.

## Dashboards

1. **Dashboards → Add "DRR Monthly Review"** (or *New dashboard*).
2. **Data:** *Use the last generated report*, or *Upload saved report files*. To compare months, upload several (for
   example three months of DRR). A totals row in a saved report is skipped. A file with no *Month* column uses its file name.
3. **Filters** at the top (tap to pick several). **Tiles** show a number, chart or table. The ⋮ menu on a tile lets you edit,
   move, delete, and download a picture (PNG) or the numbers (Excel).
4. **Save** keeps the layout, not the data.

## Back up and share

Recipes and dashboards live in this browser only. On **Home**, **Export library** saves them to one file. Do it now and
then (the amber *Unsaved to file* badge reminds you), and keep the file safe. To share with a colleague, send the file;
they choose **Import library**, see what is new and what would be overwritten, and confirm.

## On a phone

Open the site, then *Install app* (Android) or *Share → Add to Home Screen* (iPhone). It works like an app, and after the
first visit also without internet.

## If something looks wrong

| You see | What it means |
| --- | --- |
| *column X not found* | The export changed. Use **Fix mapping** and pick the new column. |
| *rows could not be matched* | A lookup found no record for those rows. They are listed, with their amount. They stay in the report under the *not found* name you chose. |
| *unreadable* values | A cell in a number or date column was not a valid number or date. It is counted as blank, and listed. |
| *Tie-out* difference | A total in an export does not equal what that file added to the report. Look at the filters and the sources. For OP Pharmacy a difference is an **error**: money is missing from the report or counted twice. |
| *Excluded from report* | Lines the recipe leaves out of the report on purpose (for the DRR: pharmacy that could not be given a doctor). They are counted with their sales and cost, and the OP Pharmacy tie-out adds them back. |
| *Pharmacy to admitted patients excluded* | Pharmacy lines sold to admitted patients are billed in the IP bill, so they are not in OP Pharmacy. Shown so the number is visible. |
| *Costs file not uploaded* | The DRR has no costs this month, so Departmental Issues, Salary, Incentives and Professional Fee are 0 and Gross Profit is before these costs. |
| *Files not used* | You added a file that no source of the recipe uses. Fine if it is not needed. |
