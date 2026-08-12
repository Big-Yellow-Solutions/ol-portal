"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api, actingAsTarget, clearActingAs } from "@/lib/api";
import type {
  ActingAs,
  Bootstrap,
  Contract,
  Deal,
  FileRecord,
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
  setDeals: React.Dispatch<React.SetStateAction<Deal[]>>;
  setProposals: React.Dispatch<React.SetStateAction<Proposal[]>>;
  setInvoices: React.Dispatch<React.SetStateAction<InvoiceRequest[]>>;
  setFiles: React.Dispatch<React.SetStateAction<FileRecord[]>>;
  setContracts: React.Dispatch<React.SetStateAction<Contract[]>>;
  setRecurrences: React.Dispatch<React.SetStateAction<Recurrence[]>>;
  refresh: () => Promise<void>;
  refreshFiles: () => Promise<void>;
  refreshProposals: () => Promise<void>;
  needsWelcome: () => boolean;
}

const PortalDataContext = createContext<PortalDataValue | undefined>(
  undefined
);

export function PortalDataProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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

  const fetchAll = useCallback(async (): Promise<void> => {
    const [bootstrap, dealsRes, proposalsRes, invoicesRes, filesRes, contractsRes, recurrencesRes] =
      await Promise.all([
        api<Bootstrap>("/bootstrap"),
        api<Deal[]>("/deals"),
        api<Proposal[]>("/proposals"),
        api<InvoiceRequest[]>("/invoices"),
        api<FileRecord[]>("/files"),
        api<Contract[]>("/contracts"),
        api<Recurrence[]>("/recurrences"),
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
  }, []);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      await fetchAll();
    } catch (err) {
      // A stale "act as" target can make bootstrap fail; retry once clean.
      if (actingAsTarget()) {
        clearActingAs();
        try {
          await fetchAll();
        } catch (retryErr) {
          setError(retryErr instanceof Error ? retryErr.message : "Failed to load portal data");
        }
      } else {
        setError(err instanceof Error ? err.message : "Failed to load portal data");
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

  const bench = useMemo(
    () => Object.entries(people).map(([username, p]) => ({ ...p, username })),
    [people]
  );

  const value = useMemo<PortalDataValue>(
    () => ({
      loading,
      error,
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
      setDeals,
      setProposals,
      setInvoices,
      setFiles,
      setContracts,
      setRecurrences,
      refresh,
      refreshFiles,
      refreshProposals,
      needsWelcome,
    }),
    [
      loading,
      error,
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
