import SimpleAzureSimulator from '../components/SimpleAzureSimulator';

// Thin page wrapper — SimpleAzureSimulator does the heavy lifting (offline catalog, AUD)
export default function Simulate() {
  return (
    <>
      <header className="page-header">
        <h1>Simulate</h1>
        <p>
          Build a what-if Azure estimate in AUD. Use any VM from the offline catalog
          (including Esv5 and other series), managed disks, and blob storage.
        </p>
      </header>
      <SimpleAzureSimulator standalone />
    </>
  );
}
