import { useRef } from "react";
import { RefreshCw } from "lucide-react";
import { MessagingSection, type MessagingSectionHandle } from "../components/MessagingSection";

export function MessagingPage() {
  const sectionRef = useRef<MessagingSectionHandle | null>(null);
  return (
    <main className="page-panel eval-page">
      <header className="page-header">
        <div>
          <p className="section-label">Messaging Gateway</p>
          <h2>Channels</h2>
        </div>
        <button className="secondary-button" type="button" onClick={() => void sectionRef.current?.refresh()}>
          <RefreshCw size={17} />
          <span>Refresh</span>
        </button>
      </header>
      <MessagingSection ref={sectionRef} />
    </main>
  );
}
