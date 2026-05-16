import { MemoryGraphPage } from "./MemoryGraphPage";

type MemoryPageProps = {
  embedded?: boolean;
};

export function MemoryPage({ embedded = false }: MemoryPageProps = {}) {
  return <MemoryGraphPage embedded={embedded} />;
}
