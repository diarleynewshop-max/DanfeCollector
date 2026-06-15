# DanfeCollector - Design Specification

## 1. Overview
DanfeCollector is a Node.js application designed to automatically synchronize fiscal documents (NF-e) directly from SEFAZ to a local environment using a digital certificate. It manages multiple CNPJs and fetches XML and PDF files via the ACBrMonitorPlus integration.

## 2. Goals
- Manage a registry of multiple CNPJs.
- Authenticate and communicate with SEFAZ via ACBrMonitorPlus (TCP Socket).
- Fetch all authorized NF-es for a CNPJ using the `distDFeInt` service.
- Handle "Manifestação do Destinatário" (Ciência da Operação) to unlock full XML downloads.
- Store XML and PDF files locally in an organized folder structure.
- Prevent duplicate downloads using a local SQLite database.

## 3. Architecture
- **Language:** Node.js (Next.js / TypeScript).
- **Communication:** TCP Sockets to ACBrMonitorPlus (Port 3434).
- **Database:** `SQLite` (via `Prisma`) to store CNPJs and download history.
- **Storage:** Local file system.

## 4. Components

### 4.1. Config Manager
Handles environment variables for ACBr host/port and local storage paths.

### 4.2. CNPJ Registry
Stores and manages the list of CNPJs (managed via Prisma).

### 4.3. ACBr Service (`src/lib/acbr.ts`)
- Manages the TCP connection with ACBrMonitorPlus.
- Sends commands (`NFe.DistribuicaoDFe`, `NFe.EnviarEvento`).
- Parses responses from the monitor.

### 4.4. Synchronization Engine
- Iterates through registered CNPJs.
- Executes `DistribuicaoDFe` to find new documents.
- If a new document is found:
  1. Sends "Ciência da Operação".
  2. Downloads the full XML.
  3. Updates the local database.

### 4.5. Storage Provider
Organizes files as: `downloads/{CNPJ}/{YEAR}/{MONTH}/{ACCESS_KEY}.xml`.

## 5. Data Flow
1. User triggers sync via Dashboard or Cron.
2. App retrieves active CNPJs from SQLite.
3. For each CNPJ:
   - Call ACBr `NFe.DistribuicaoDFe`.
   - For each returned item:
     - If it's a "Resumo": Send "Ciência da Operação" and re-sync to get the full XML.
     - Save XML to disk and log to `NotaFiscal` table.

## 6. Error Handling
- **ACBr Offline:** Log error and notify user to start ACBrMonitorPlus.
- **SEFAZ Outage:** Implement retries.
- **Certificate Issues:** Detection of expired or invalid certificates via ACBr responses.

## 7. Success Criteria
- Successfully download XMLs directly from SEFAZ without third-party API costs.
- Automated manifestation flow.
- Organized local storage.
