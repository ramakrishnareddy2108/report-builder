import { Download, FileSpreadsheet, LayoutDashboard, Play, Share2, ShieldCheck, Smartphone } from 'lucide-react';
import { useState } from 'react';
import { useAppStore } from '@/app/store';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EVERYDAY, FORMULA_GROUPS, SAMPLE_ROW, showValue } from './formulaDocs';

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] break-words">{children}</code>;
}

const STEPS = [
  {
    icon: FileSpreadsheet,
    title: 'Create a recipe (once)',
    text: 'A recipe tells the app how to turn your Excel exports into a report. On Home, choose New recipe (or add the starter recipes). Add a sample file of each export, tick the columns you need, set up the report, and choose what the finished file looks like. Try it on your sample files, then Save.',
  },
  {
    icon: Play,
    title: 'Generate (every month)',
    text: 'Open the recipe with Generate, add this month’s Excel files, check the month, and press Generate. Read the checks: they list everything that was left out, not found or looks odd. Then download the report.',
  },
  {
    icon: LayoutDashboard,
    title: 'Look at dashboards',
    text: 'On Dashboards, use the last report you generated, or upload several saved reports (for example three months) to compare them. Tiles show numbers, charts and tables. Save the layout to reuse it.',
  },
  {
    icon: Download,
    title: 'Back up your library',
    text: 'Recipes and dashboards live in this browser only. Use Export library on Home now and then. It saves one file you can keep safe. The “Unsaved to file” badge at the top reminds you.',
  },
  {
    icon: Share2,
    title: 'Share with a colleague',
    text: 'Send them the exported library file. On their Home page they choose Import library. They see what is new and what will be overwritten before anything changes.',
  },
];

export function HelpPage() {
  const go = useAppStore((s) => s.go);
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const groups = FORMULA_GROUPS.map((g) => ({ ...g, docs: g.docs.filter((d) => q === '' || `${d.name} ${d.text} ${d.syntax}`.toLowerCase().includes(q)) })).filter((g) => g.docs.length > 0);

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <PageHeader title="Help" description="A short how-to, and the formula reference." />

      <section aria-labelledby="quick-h" className="space-y-4">
        <h2 id="quick-h" className="text-xl font-semibold">
          Quick start
        </h2>
        <ol className="space-y-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-3 rounded-lg border p-4">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground" aria-hidden>
                {i + 1}
              </span>
              <div className="space-y-1">
                <h3 className="flex items-center gap-2 font-medium">
                  <s.icon className="size-4 text-muted-foreground" aria-hidden /> {s.title}
                </h3>
                <p className="text-sm text-muted-foreground">{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => go({ page: 'home' })}>Go to Home</Button>
          <Button variant="outline" onClick={() => go({ page: 'generate' })}>
            Generate a report
          </Button>
        </div>
      </section>

      <section aria-labelledby="phone-h" className="space-y-3">
        <h2 id="phone-h" className="flex items-center gap-2 text-xl font-semibold">
          <Smartphone className="size-5" aria-hidden /> Use it on your phone
        </h2>
        <p className="text-sm text-muted-foreground">The app works in any modern browser and can be installed like an app. After the first visit it also works without internet.</p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>
            <b>Android (Chrome):</b> tap <b>Install app</b> at the top, or the browser menu → <i>Install app</i>.
          </li>
          <li>
            <b>iPhone (Safari):</b> tap the Share button → <i>Add to Home Screen</i>.
          </li>
          <li>
            <b>Computer (Chrome or Edge):</b> the install icon in the address bar, or <b>Install app</b> at the top.
          </li>
        </ul>
        <p className="text-sm text-muted-foreground">Reports are saved with your phone’s normal download. Your Excel files are only read by this page. They are not uploaded anywhere.</p>
      </section>

      <section aria-labelledby="private-h" className="space-y-3">
        <h2 id="private-h" className="flex items-center gap-2 text-xl font-semibold">
          <ShieldCheck className="size-5" aria-hidden /> What is saved, and what is not
        </h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>
            <b>Saved in this browser:</b> your recipes and dashboard layouts (and the Excel template inside a recipe).
          </li>
          <li>
            <b>Never saved:</b> the Excel files you add, the numbers in them, names of patients or doctors, and the reports you generate. They live in memory until you close or reload the page.
          </li>
          <li>Patient names, phone numbers and addresses cannot even be picked as columns.</li>
          <li>Use an <b>empty</b> template. If a template already holds names and amounts, they would be saved inside the recipe, so the app refuses it.</li>
        </ul>
      </section>

      <section aria-labelledby="formulas-h" className="space-y-4">
        <div>
          <h2 id="formulas-h" className="text-xl font-semibold">
            Formulas
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Formulas work like Excel’s, with one difference: a column is written by its name in square brackets, like <Code>[Amount]</Code> (or by its letter, like <Code>[F]</Code>). Text goes in double quotes, like <Code>&quot;OP Billing&quot;</Code>. Capital letters do not matter when comparing text. An empty cell counts as 0 or as empty text. Dividing by zero is an error, which <Code>IFERROR</Code> can replace.
          </p>
        </div>

        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-semibold">The sample row the examples use</summary>
          <p className="mt-2 text-sm text-muted-foreground">
            {Object.entries(SAMPLE_ROW).map(([k, v], i) => (
              <span key={k}>
                {i > 0 && ' · '}
                <Code>[{k}]</Code> = {showValue(v)}
              </span>
            ))}
          </p>
        </details>

        <h3 className="text-base font-semibold">Everyday jobs</h3>
        <ul className="space-y-3">
          {EVERYDAY.map((e) => (
            <li key={e.title} className="space-y-1 rounded-lg border p-3 text-sm">
              <p className="font-medium">{e.title}</p>
              <p className="text-muted-foreground">{e.text}</p>
              <p>
                <Code>{e.formula}</Code> <span className="text-muted-foreground">→ {e.result}</span>
              </p>
            </li>
          ))}
        </ul>

        <h3 className="text-base font-semibold">All functions</h3>
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search a function, for example round or text" aria-label="Search the functions" />
        {groups.length === 0 && <p className="text-sm text-muted-foreground">No function matches “{query}”.</p>}
        {groups.map((g) => (
          <div key={g.title} className="space-y-2">
            <h4 className="text-sm font-semibold">{g.title}</h4>
            <ul className="divide-y rounded-lg border">
              {g.docs.map((f) => (
                <li key={f.name} className="space-y-1 p-3 text-sm">
                  <p>
                    <Code>{f.syntax}</Code>
                  </p>
                  <p className="text-muted-foreground">{f.text}</p>
                  <p>
                    <Code>{f.example}</Code> <span className="text-muted-foreground">→ {f.result}</span>
                  </p>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <p className="text-sm text-muted-foreground">
          Operators: <Code>+ - * / ^ &amp; = &lt;&gt; &lt; &gt; &lt;= &gt;=</Code> and <Code>%</Code> (for example <Code>20%</Code> is 0.2).
        </p>
      </section>
    </div>
  );
}
