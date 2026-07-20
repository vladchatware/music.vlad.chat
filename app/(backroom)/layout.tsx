const themeScript = `
  try {
    const stored = localStorage.getItem("revibe-backroom-theme");
    if (stored === "light" || stored === "dark") {
      document.documentElement.dataset.backroomTheme = stored;
    }
  } catch {}
`;

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      {children}
    </>
  );
}
