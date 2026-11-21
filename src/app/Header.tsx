export function Header() {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-4 md:px-6">
      <span className="text-base font-semibold md:hidden">Report Builder</span>
      <span className="hidden text-sm text-muted-foreground md:inline">Excel exports in, finished report out.</span>
      <div id="header-actions" className="flex items-center gap-2" />
    </header>
  );
}
