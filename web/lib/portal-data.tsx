"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api, ApiError, actingAsTarget, clearActingAs } from "@/lib/api";
import { isActive } from "@/lib/data";
import type {
  ActingAs,
  Bootstrap,
  Company,
  Contact,
  Contract,
  Deal,
  FileRecord,
  Guide,
  InvoiceRequest,
  Lab,
  Person,
  Proposal,
  Recurrence,
  Role,
} from "@/lib/types";

const WELCOME_SKIPPED_KEY = "olportal.welcomeSkipped";

// `people` is keyed by username with the key stripped from each value
// (mirrors bootstrap's raw response) — this re-attaches it for call sites
// that need to identify who a Person is (e.g. bench directory cards).
export type PersonWithUsername = Person & { username: string };

interface PortalDataValue {
  loading: boolean;
  error: string | null;
  /* HTTP status behind `error`, so a caller can tell an authorization
     refusal (the API knows who you are and says no, or cannot find a profile
     for you) from a request that simply failed. `null` for a network or
     parse failure, which carries no status at all. */
  errorStatus: number | null;
  labs: Lab[];
  people: Record<string, Person>;
  role: Role | null;
  me: string | null;
  actingAs: ActingAs | null;
  myLabs: string[];
  bench: PersonWithUsername[];
  deals: Deal[];
  proposals: Proposal[];
  invoices: InvoiceRequest[];
  files: FileRecord[];
  contracts: Contract[];
  recurrences: Recurrence[];
  guides: Guide[];
  companies: Company[];
  contacts: Contact[];
  setDeals: React.Dispatch<React.SetStateAction<Deal[]>>;
  setProposals: React.Dispatch<React.SetStateAction<Proposal[]>>;
  setInvoices: React.Dispatch<React.SetStateAction<InvoiceRequest[]>>;
  setFiles: React.Dispatch<React.SetStateAction<FileRecord[]>>;
  setContracts: React.Dispatch<React.SetStateAction<Contract[]>>;
  setRecurrences: React.Dispatch<React.SetStateAction<Recurrence[]>>;
  setCompanies: React.Dispatch<React.SetStateAction<Company[]>>;
  setContacts: React.Dispatch<React.SetStateAction<Contact[]>>;
  refresh: () => Promise<void>;
  refreshFiles: () => Promise<void>;
  refreshProposals: () => Promise<void>;
  needsWelcome: () => boolean;
}

const PortalDataContext = createContext<PortalDataValue | undefined>(
  undefined
);

/* The portal's whole first paint needs ten endpoints, and firing them at once
   is what a Promise.all does. That is more parallelism than this AWS account
   has: its Lambda concurrent-execution quota is 10 for every function
   together, and each API call also invokes the authorizer, so one page load
   asks for roughly twice the account's entire budget and API Gateway answers
   the overflow with 503. The portal then boots with whichever half survived —
   an empty roster, no labs, "Welcome back, there".

   Running them a few at a time keeps a page load inside the budget and costs
   a little latency. Raising the quota is the real fix; this makes the app
   behave while it is still 10, and behave better than a burst afterwards.

   Ordering is preserved, so callers keep destructuring positionally. The
   first rejection still rejects the whole thing, exactly as Promise.all did:
   these responses are load-bearing and a half-loaded portal is worse than a
   reported failure. */
const BOOT_BATCH = 3;

type Awaitedeach<T> = { -readonly [K in keyof T]: Awaited<ReturnType<
  T[K] extends () => Promise<unknown> ? T[K] : never
>> };

async function inBatches<T extends readonly (() => Promise<unknown>)[]>(
  tasks: readonly [...T]
): Promise<Awaitedeach<T>> {
  const out: unknown[] = [];
  for (let i = 0; i < tasks.length; i += BOOT_BATCH) {
    out.push(...(await Promise.all(tasks.slice(i, i + BOOT_BATCH).map(run => run()))));
  }
  return out as Awaitedeach<T>;
}

export function PortalDataProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [labs, setLabs] = useState<Lab[]>([]);
  const [people, setPeople] = useState<Record<string, Person>>({});
  const [role, setRole] = useState<Role | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [actingAs, setActingAsInfo] = useState<ActingAs | null>(null);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRequest[]>([]);
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [recurrences, setRecurrences] = useState<Recurrence[]>([]);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);

  const fetchAll = useCallback(async (): Promise<void> => {
    const [
      bootstrap, dealsRes, proposalsRes, invoicesRes, filesRes, contractsRes,
      recurrencesRes, guidesRes, companiesRes, contactsRes,
    ] =
      await inBatches([
        () => api<Bootstrap>("/bootstrap"),
        () => api<Deal[]>("/deals"),
        () => api<Proposal[]>("/proposals"),
        () => api<InvoiceRequest[]>("/invoices"),
        () => api<FileRecord[]>("/files"),
        () => api<Contract[]>("/contracts"),
        () => api<Recurrence[]>("/recurrences"),
        () => api<Guide[]>("/guides"),
        // Pipeline v2's billing-entity endpoints. Every other request here is
        // load-bearing — one rejection fails the whole Promise.all and every
        // page renders the error state — but these two are new, so a frontend
        // build can reach a Lambda that predates them (a static export ships
        // on push; the backend deploys separately). An empty list degrades
        // Pipeline's billing panel to "add a new company" and leaves the rest
        // of the portal working, which is the right failure for a partial
        // deploy or an independent backend rollback.
        () => api<Company[]>("/companies").catch(() => [] as Company[]),
        () => api<Contact[]>("/contacts").catch(() => [] as Contact[]),
      ]);
    setLabs(Object.entries(bootstrap.labs).map(([id, lab]) => ({ id, name: lab.name })));
    setPeople(bootstrap.people);
    setRole(bootstrap.role);
    setMe(bootstrap.me);
    setActingAsInfo(bootstrap.actingAs ?? null);
    setDeals(dealsRes);
    setProposals(proposalsRes);
    setInvoices(invoicesRes);
    setFiles(filesRes);
    setContracts(contractsRes);
    setRecurrences(recurrencesRes);
    setGuides(guidesRes);
    setCompanies(companiesRes);
    setContacts(contactsRes);
  }, []);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    setErrorStatus(null);
    const fail = (err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to load portal data");
      setErrorStatus(err instanceof ApiError ? err.status : null);
    };
    try {
      await fetchAll();
    } catch (err) {
      // A stale "act as" target can make bootstrap fail; retry once clean.
      if (actingAsTarget()) {
        clearActingAs();
        try {
          await fetchAll();
        } catch (retryErr) {
          fail(retryErr);
        }
      } else {
        fail(err);
      }
    } finally {
      setLoading(false);
    }
  }, [fetchAll]);

  const refresh = useCallback(() => load(), [load]);

  useEffect(() => {
    load();
    // Intentionally run once on mount — `load` only changes identity if
    // `fetchAll` does, which never does (empty dep array).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshFiles = useCallback(async () => {
    setFiles(await api<FileRecord[]>("/files"));
  }, []);

  const refreshProposals = useCallback(async () => {
    setProposals(await api<Proposal[]>("/proposals"));
  }, []);

  const needsWelcome = useCallback((): boolean => {
    if (!me) return false;
    const skipped =
      typeof window !== "undefined" &&
      window.localStorage.getItem(WELCOME_SKIPPED_KEY) === "1";
    return !people[me]?.onboarded && !skipped;
  }, [me, people]);

  const myLabs = useMemo(() => {
    if (!me) return [];
    return people[me]?.labs ?? [];
  }, [me, people]);

  /* Offboarded people stay in `people` so an owner reference still resolves
     to a name, but they are not on the bench: the directory, the message
     recipient picker and the related-people card all read this. */
  const bench = useMemo(
    () =>
      Object.entries(people)
        .filter(([, p]) => isActive(p))
        .map(([username, p]) => ({ ...p, username })),
    [people]
  );

  const value = useMemo<PortalDataValue>(
    () => ({
      loading,
      error,
      errorStatus,
      labs,
      people,
      role,
      me,
      actingAs,
      myLabs,
      bench,
      deals,
      proposals,
      invoices,
      files,
      contracts,
      recurrences,
      guides,
      companies,
      contacts,
      setDeals,
      setProposals,
      setInvoices,
      setFiles,
      setContracts,
      setRecurrences,
      setCompanies,
      setContacts,
      refresh,
      refreshFiles,
      refreshProposals,
      needsWelcome,
    }),
    [
      loading,
      error,
      errorStatus,
      labs,
      people,
      role,
      me,
      actingAs,
      myLabs,
      bench,
      deals,
      proposals,
      invoices,
      files,
      contracts,
      recurrences,
      guides,
      companies,
      contacts,
      refresh,
      refreshFiles,
      refreshProposals,
      needsWelcome,
    ]
  );

  return (
    <PortalDataContext.Provider value={value}>
      {children}
    </PortalDataContext.Provider>
  );
}

export function usePortalData(): PortalDataValue {
  const ctx = useContext(PortalDataContext);
  if (!ctx) throw new Error("usePortalData must be used within PortalDataProvider");
  return ctx;
}

export { WELCOME_SKIPPED_KEY };
