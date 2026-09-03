"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { usePortalData } from "@/lib/portal-data";
import { api, ApiError } from "@/lib/api";
import { CONFIG } from "@/lib/config";
import { startActingAs } from "@/lib/act-as";
import type { Role } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import type { BadgeVariant } from "@/lib/data";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

/* ---------- shapes returned by the real backend (admin.mjs / kb.mjs) ---------- */

interface AdminUser {
  username: string;
  email: string;
  status: string;
  created: string;
  mfaEnrolled: boolean;
  firstName: string;
  lastName: string;
  name: string;
  role: Role | "";
  labs: string[];
  active: boolean;
}

interface AuditEntry {
  at: string;
  actor: string;
  action: string;
  detail?: string;
}

interface KbEntry {
  id: string;
  title: string;
  content: string;
  lab?: string;
  updated: string;
  updatedBy: string;
}

const ROLE_OPTIONS: Role[] = ["Lab Leader", "Contributor", "Admin"];

/* What each directory does on invite and on reset, in the words the admin
   sees. The mechanics differ (a temporary password vs. an invitation link; a
   recreated account vs. a removed authenticator) and the copy must not
   promise one while the backend does the other. */
const WORKOS = CONFIG.authProvider === "workos";
const COPY = WORKOS
  ? {
      invited: (email: string) => `Invite sent to ${email} — the link is valid for 7 days.`,
      inviteNote:
        "WorkOS emails an invitation link valid for 7 days. The person sets their own password (12+ chars, breach-checked) on the way in.",
      resetConfirm: (u: string) =>
        `Reset two-factor for "${u}"? Verify their identity out-of-band first (call or known email thread). Their authenticator is removed and they enroll a new one at next sign-in. Their password and portal data are untouched.`,
      resetDone: (u: string) => `Two-factor reset for ${u}. They re-enroll at next sign-in.`,
      resetLabel: "Reset 2FA",
      emailNote: (u: string) =>
        `New sign-in email for ${u}. They sign in with the new address from now on, and their portal profile moves with it.`,
    }
  : {
      invited: (email: string) => `Invite sent to ${email} — temp password valid 7 days.`,
      inviteNote:
        "Cognito emails a temporary password valid for 7 days. First sign-in forces a new password (12+ chars, breach-checked) and two-factor enrollment.",
      resetConfirm: (u: string) =>
        `Reset access for "${u}"? Verify their identity out-of-band first (call or known email thread). They get a new emailed temporary password and re-enroll two-factor at next sign-in. Their portal data is untouched.`,
      resetDone: (u: string) => `Access reset for ${u}. A new temporary password was emailed.`,
      resetLabel: "Reset access",
      emailNote: (u: string) =>
        `New contact email for ${u}. Their sign-in username stays ${u} — Cognito usernames can\u2019t be renamed.`,
    };

/* Cognito's vocabulary, kept under WorkOS too: directory.mjs maps a pending
   invitation onto FORCE_CHANGE_PASSWORD and a user onto CONFIRMED, so this
   page reads one contract whichever directory is behind it. NO_ACCOUNT is a
   portal profile with nothing to sign in with — the state the re-seeded
   roster sits in until each person is invited. */
const STATUS_BADGE: Record<string, [BadgeVariant, string]> = {
  CONFIRMED: ["success", "Active"],
  FORCE_CHANGE_PASSWORD: ["warning", "Invite pending"],
  NO_ACCOUNT: ["outline", "No account"],
  DEACTIVATED: ["destructive", "Offboarded"],
  RESET_REQUIRED: ["destructive", "Reset required"],
};

// Radix Select forbids an empty-string item value, so "all labs" is
// represented locally by this sentinel and translated at the API boundary.
const NO_LAB = "__none__";

function errMsg(e: unknown): string {
  return e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Something went wrong";
}

export default function AdminPage() {
  const { role, labs, me } = usePortalData();

  if (role !== "Admin") {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-ink-mute">
        This page is for OL admins only.
      </div>
    );
  }

  return <AdminConsole myUsername={me} labs={labs} />;
}

function AdminConsole({
  myUsername,
  labs,
}: {
  myUsername: string | null;
  labs: { id: string; name: string }[];
}) {
  const labName = useCallback(
    (key: string) => labs.find((l) => l.id === key)?.name || key,
    [labs]
  );

  /* ---------- accounts + invites ---------- */
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(true);
  const [busyUser, setBusyUser] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    try {
      setUsers(await api<AdminUser[]>("/admin/users"));
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setUsersLoading(false);
    }
  }, []);

  const loadAudit = useCallback(async () => {
    try {
      setAudit(await api<AuditEntry[]>("/admin/audit"));
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setAuditLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
    loadAudit();
  }, [loadUsers, loadAudit]);

  /* ---------- invite form ---------- */
  const [invFirstName, setInvFirstName] = useState("");
  const [invLastName, setInvLastName] = useState("");
  const [invEmail, setInvEmail] = useState("");
  const [invRole, setInvRole] = useState<Role>("Lab Leader");
  const [invLabs, setInvLabs] = useState<Set<string>>(new Set());
  const [inviting, setInviting] = useState(false);

  const toggleInvLab = (key: string, checked: boolean) => {
    setInvLabs((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const submitInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviting(true);
    try {
      await api("/admin/invites", {
        method: "POST",
        body: JSON.stringify({
          firstName: invFirstName.trim(),
          lastName: invLastName.trim(),
          email: invEmail.trim(),
          role: invRole,
          labs: [...invLabs],
        }),
      });
      toast.success(COPY.invited(invEmail.trim()));
      setInvFirstName("");
      setInvLastName("");
      setInvEmail("");
      setInvRole("Lab Leader");
      setInvLabs(new Set());
      await loadUsers();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setInviting(false);
    }
  };

  /* ---------- account row actions ---------- */
  const resendInvite = async (username: string) => {
    setBusyUser(username);
    try {
      await api(`/admin/invites/${username}/resend`, { method: "POST" });
      toast.success("Invite email resent.");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusyUser(null);
    }
  };

  const revokeInvite = async (username: string) => {
    if (!confirm(`Revoke the invite for "${username}"? Their account and profile are removed.`)) return;
    setBusyUser(username);
    try {
      await api(`/admin/invites/${username}`, { method: "DELETE" });
      toast.success(`Invite for ${username} revoked.`);
      await loadUsers();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusyUser(null);
    }
  };

  const resetMfa = async (username: string) => {
    if (!confirm(COPY.resetConfirm(username))) return;
    setBusyUser(username);
    try {
      await api(`/admin/users/${username}/reset-mfa`, { method: "POST" });
      toast.success(COPY.resetDone(username));
      await loadUsers();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusyUser(null);
    }
  };

  const [emailDialogUser, setEmailDialogUser] = useState<AdminUser | null>(null);
  const [emailDraft, setEmailDraft] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);

  const openEmailDialog = (u: AdminUser) => {
    setEmailDialogUser(u);
    setEmailDraft(u.email);
  };

  const saveEmail = async () => {
    if (!emailDialogUser) return;
    setSavingEmail(true);
    try {
      await api(`/admin/users/${emailDialogUser.username}`, {
        method: "PATCH",
        body: JSON.stringify({ email: emailDraft.trim() }),
      });
      toast.success("Email updated.");
      setEmailDialogUser(null);
      await loadUsers();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSavingEmail(false);
    }
  };

  /* Role and labs live on the PERSON record, which is what buildContext reads
     on every request — so a change here lands on the person's next request
     with no re-invite and no sign-out. Self is left off the row on purpose:
     the backend refuses it too, and that refusal is what keeps the org from
     ever being left without an Admin. */
  const [accessDialogUser, setAccessDialogUser] = useState<AdminUser | null>(null);
  const [accessRole, setAccessRole] = useState<Role>("Contributor");
  const [accessLabs, setAccessLabs] = useState<Set<string>>(new Set());
  const [savingAccess, setSavingAccess] = useState(false);

  const openAccessDialog = (u: AdminUser) => {
    setAccessDialogUser(u);
    setAccessRole((u.role || "Contributor") as Role);
    setAccessLabs(new Set(u.labs || []));
  };

  const toggleAccessLab = (key: string, checked: boolean) => {
    setAccessLabs((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const saveAccess = async () => {
    if (!accessDialogUser) return;
    setSavingAccess(true);
    try {
      await api(`/admin/users/${accessDialogUser.username}/access`, {
        method: "PATCH",
        body: JSON.stringify({ role: accessRole, labs: [...accessLabs] }),
      });
      toast.success(
        `${accessDialogUser.name || accessDialogUser.username} is now a ${accessRole}.`
      );
      setAccessDialogUser(null);
      await loadUsers();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSavingAccess(false);
    }
  };

  /* Offboarding is deactivation, not deletion: the sign-in is removed and the
     record is marked, so a deal this person owned still resolves to their
     name. Restore re-invites them — the directory account is gone, so there is
     nothing to switch back on. */
  const offboard = async (u: AdminUser) => {
    const who = u.name || u.username;
    if (
      !confirm(
        `Offboard ${who}? Their sign-in is removed and any unaccepted invite is revoked, and they lose portal access immediately — even if they're signed in right now.\n\nTheir profile is kept, so deals and contracts they own still show their name. You can restore them later, which sends a fresh invite.`
      )
    )
      return;
    setBusyUser(u.username);
    try {
      await api(`/admin/users/${u.username}/offboard`, { method: "POST" });
      toast.success(`${who} has been offboarded.`);
      await loadUsers();
      await loadAudit();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusyUser(null);
    }
  };

  const restore = async (u: AdminUser) => {
    const who = u.name || u.username;
    if (!confirm(`Restore ${who} as a ${u.role}? A fresh invite is emailed and their labs come back with them.`))
      return;
    setBusyUser(u.username);
    try {
      await api(`/admin/users/${u.username}/restore`, { method: "POST" });
      toast.success(`${who} restored — an invite is on its way.`);
      await loadUsers();
      await loadAudit();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusyUser(null);
    }
  };

  const actAs = async (username: string) => {
    setBusyUser(username);
    try {
      if (!(await startActingAs(username))) setBusyUser(null);
    } catch (e) {
      toast.error(errMsg(e));
      setBusyUser(null);
    }
  };

  /* ---------- knowledge base ---------- */
  const [kb, setKb] = useState<KbEntry[]>([]);
  const [kbLoading, setKbLoading] = useState(true);

  const loadKb = useCallback(async () => {
    try {
      setKb(await api<KbEntry[]>("/kb"));
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setKbLoading(false);
    }
  }, []);

  useEffect(() => {
    loadKb();
  }, [loadKb]);

  const [kbDialogOpen, setKbDialogOpen] = useState(false);
  const [kbEditing, setKbEditing] = useState<KbEntry | null>(null);
  const [kbTitle, setKbTitle] = useState("");
  const [kbLab, setKbLab] = useState(NO_LAB);
  const [kbContent, setKbContent] = useState("");
  const [kbSaving, setKbSaving] = useState(false);

  const openCreateKb = () => {
    setKbEditing(null);
    setKbTitle("");
    setKbLab(NO_LAB);
    setKbContent("");
    setKbDialogOpen(true);
  };

  const openEditKb = (entry: KbEntry) => {
    setKbEditing(entry);
    setKbTitle(entry.title);
    setKbLab(entry.lab || NO_LAB);
    setKbContent(entry.content);
    setKbDialogOpen(true);
  };

  const submitKb = async (e: React.FormEvent) => {
    e.preventDefault();
    setKbSaving(true);
    const lab = kbLab === NO_LAB ? "" : kbLab;
    try {
      if (kbEditing) {
        await api(`/kb/${kbEditing.id}`, {
          method: "PATCH",
          body: JSON.stringify({ title: kbTitle.trim(), content: kbContent, lab }),
        });
        toast.success("Entry updated.");
      } else {
        await api("/kb", {
          method: "POST",
          body: JSON.stringify({ title: kbTitle.trim(), content: kbContent, lab }),
        });
        toast.success("Entry added.");
      }
      setKbDialogOpen(false);
      await loadKb();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setKbSaving(false);
    }
  };

  const deleteKb = async (entry: KbEntry) => {
    if (!confirm(`Delete the knowledge base entry "${entry.title}"?`)) return;
    try {
      await api(`/kb/${entry.id}`, { method: "DELETE" });
      toast.success("Entry deleted.");
      await loadKb();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const sortedUsers = useMemo(
    () => [...users].sort((a, b) => a.username.localeCompare(b.username)),
    [users]
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-serif text-2xl italic text-ink">
          Admin &amp; invites
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-mute">
          Invite people to the portal, manage accounts and two-factor, and review the
          authentication audit log. The portal is invite-only; self-registration is never
          allowed.
        </p>
      </div>

      <Tabs defaultValue="accounts">
        <TabsList>
          <TabsTrigger value="accounts">Invites &amp; accounts</TabsTrigger>
          <TabsTrigger value="kb">The Optimist knowledge base</TabsTrigger>
          <TabsTrigger value="audit">Audit log</TabsTrigger>
        </TabsList>

        {/* ---------- Invites & accounts ---------- */}
        <TabsContent value="accounts" className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="font-serif text-lg">Invite someone</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={submitInvite} className="flex flex-col gap-4">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="invFirstName">First name</Label>
                    <Input
                      id="invFirstName"
                      required
                      value={invFirstName}
                      onChange={(e) => setInvFirstName(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="invLastName">Last name</Label>
                    <Input
                      id="invLastName"
                      required
                      value={invLastName}
                      onChange={(e) => setInvLastName(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="invEmail">Email</Label>
                    <Input
                      id="invEmail"
                      type="email"
                      required
                      value={invEmail}
                      onChange={(e) => setInvEmail(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="invRole">Role</Label>
                    <Select value={invRole} onValueChange={(v) => setInvRole(v as Role)}>
                      <SelectTrigger id="invRole" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLE_OPTIONS.map((r) => (
                          <SelectItem key={r} value={r}>
                            {r}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium text-ink">
                    Labs (for Lab Leaders / Contributors)
                  </span>
                  <div className="flex flex-wrap gap-4">
                    {labs.map((lab) => (
                      <label
                        key={lab.id}
                        className="flex items-center gap-2 text-sm text-ink-soft"
                      >
                        <Checkbox
                          checked={invLabs.has(lab.id)}
                          onCheckedChange={(c) => toggleInvLab(lab.id, c === true)}
                        />
                        {lab.name}
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <Button type="submit" disabled={inviting}>
                    {inviting ? "Sending…" : "Send invite"}
                  </Button>
                </div>
              </form>

              <p className="mt-4 text-xs text-ink-mute">
                {COPY.inviteNote} Lab-Leader-initiated Contributor invites stay admin-only
                until contract automation exists (PRD 2.2).
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="font-serif text-lg">Accounts</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Person</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role · Labs</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>2FA</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usersLoading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-ink-mute">
                        Loading…
                      </TableCell>
                    </TableRow>
                  ) : sortedUsers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-ink-mute">
                        No users yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    sortedUsers.map((u) => {
                      const [statusVariant, statusLabel] = STATUS_BADGE[u.status] || [
                        "outline",
                        u.status,
                      ];
                      const pending = u.status === "FORCE_CHANGE_PASSWORD";
                      const offboarded = !u.active;
                      const hasAccount = u.status !== "NO_ACCOUNT" && !offboarded;
                      const self = u.username === myUsername;
                      const busy = busyUser === u.username;
                      return (
                        <TableRow key={u.username}>
                          <TableCell className="font-medium text-ink">
                            {u.name || u.username}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5 whitespace-nowrap">
                              {u.email || <span className="text-red">no email</span>}
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                title="Change email"
                                onClick={() => openEmailDialog(u)}
                              >
                                ✎
                              </Button>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5 whitespace-nowrap">
                              {u.role || <span className="text-red">no role</span>}
                              {/* An empty role means no PERSON record at all — a
                                  directory account nobody invited. There is
                                  nothing to edit, and the backend refuses it
                                  with a 404, which is the invite-only rule
                                  doing its job rather than a bug to work
                                  around. */}
                              {!self && u.role && (
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  title="Change role and labs"
                                  onClick={() => openAccessDialog(u)}
                                >
                                  ✎
                                </Button>
                              )}
                            </div>
                            <div className="text-xs text-ink-mute">
                              {(u.labs || []).map((k) => labName(k)).join(", ")}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={statusVariant}>{statusLabel}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant={u.mfaEnrolled ? "success" : "outline"}>
                              {u.mfaEnrolled ? "2FA on" : "2FA not set"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1.5">
                              {pending && !offboarded && (
                                <>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={busy}
                                    onClick={() => resendInvite(u.username)}
                                  >
                                    Resend invite
                                  </Button>
                                  <Button
                                    variant="destructive"
                                    size="sm"
                                    disabled={busy}
                                    onClick={() => revokeInvite(u.username)}
                                  >
                                    Revoke
                                  </Button>
                                </>
                              )}
                              {!pending && hasAccount && !self && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={busy}
                                  onClick={() => resetMfa(u.username)}
                                >
                                  {COPY.resetLabel}
                                </Button>
                              )}
                              {!pending && !self && !offboarded && u.role !== "Admin" && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={busy}
                                  onClick={() => actAs(u.username)}
                                >
                                  Act as
                                </Button>
                              )}
                              {!self && !offboarded && (
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  disabled={busy}
                                  onClick={() => offboard(u)}
                                >
                                  Offboard
                                </Button>
                              )}
                              {offboarded && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={busy}
                                  onClick={() => restore(u)}
                                >
                                  Restore
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------- Knowledge base ---------- */}
        <TabsContent value="kb" className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="font-serif text-lg">
                The Optimist&rsquo;s knowledge base
              </CardTitle>
              <CardDescription>
                What The Optimist (OL&rsquo;s proposal writer) is grounded in (PRD 3.8):
                past-proposal patterns, pricing frameworks, tone of voice. Keep it fresh — stale
                inputs degrade the drafts. Content should not include client-confidential
                details. The canonical section structure is Liz&rsquo;s{" "}
                <a
                  href="https://docs.google.com/document/d/1EsCqHQzSOC9--RmvYbvxXbwqPnAoyHV5MkUQ0-Z-9vU/edit?usp=sharing"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-violet-deep underline underline-offset-2"
                >
                  Optimist proposal template (Google Doc)
                </a>
                .
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {kbLoading ? (
                <p className="text-sm text-ink-mute">Loading…</p>
              ) : kb.length === 0 ? (
                <p className="text-sm text-ink-mute">
                  Empty — the assistant will say so and draft from general best practice. Seed
                  it with pricing frameworks and past winning proposals.
                </p>
              ) : (
                <ul className="flex flex-col divide-y divide-hair">
                  {kb.map((entry) => (
                    <li key={entry.id} className="flex items-start gap-3 py-3">
                      <span className="mt-1.5 size-2 shrink-0 rounded-full bg-violet-deep" />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-ink">{entry.title}</div>
                        <div className="whitespace-pre-wrap text-sm text-ink-mute">
                          {entry.content.length > 240
                            ? entry.content.slice(0, 240) + "…"
                            : entry.content}
                        </div>
                        <div className="mt-1 text-xs text-ink-mute">
                          {entry.lab ? labName(entry.lab) : "All labs"} · updated{" "}
                          {entry.updated} by {entry.updatedBy}
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        <Button variant="outline" size="sm" onClick={() => openEditKb(entry)}>
                          Edit
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => deleteKb(entry)}
                        >
                          Delete
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <div>
                <Button onClick={openCreateKb}>Add entry</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------- Audit log ---------- */}
        <TabsContent value="audit">
          <Card>
            <CardHeader>
              <CardTitle className="font-serif text-lg">Auth audit log</CardTitle>
              <CardDescription>
                Sign-ins, invites, email changes, and 2FA resets. Kept for 90 days. Failed
                sign-in attempts are in CloudTrail.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {auditLoading ? (
                <p className="text-sm text-ink-mute">Loading…</p>
              ) : audit.length === 0 ? (
                <p className="text-sm text-ink-mute">No auth events recorded yet.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-hair">
                  {audit.map((a, i) => (
                    <li key={i} className="flex items-start gap-3 py-3">
                      <span
                        className={`mt-1.5 size-2 shrink-0 rounded-full ${
                          a.action.startsWith("auth.") ? "bg-green" : "bg-violet-deep"
                        }`}
                      />
                      <div className="min-w-0 flex-1 text-sm text-ink">
                        <span className="font-medium">{a.action}</span> · {a.actor}
                        {a.detail ? ` · ${a.detail}` : ""}
                        <div className="text-xs text-ink-mute">{a.at} UTC</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ---------- change email dialog ---------- */}
      <Dialog open={!!emailDialogUser} onOpenChange={(open) => !open && setEmailDialogUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change contact email</DialogTitle>
            <DialogDescription>
              {emailDialogUser && COPY.emailNote(emailDialogUser.username)}
            </DialogDescription>
          </DialogHeader>
          <Input
            type="email"
            value={emailDraft}
            onChange={(e) => setEmailDraft(e.target.value)}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmailDialogUser(null)}>
              Cancel
            </Button>
            <Button onClick={saveEmail} disabled={savingEmail || !emailDraft.trim()}>
              {savingEmail ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- change role + labs dialog ---------- */}
      <Dialog
        open={!!accessDialogUser}
        onOpenChange={(open) => !open && setAccessDialogUser(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change role &amp; labs</DialogTitle>
            <DialogDescription>
              {accessDialogUser &&
                `${accessDialogUser.name || accessDialogUser.username} — takes effect on their next request. They don\u2019t need to sign in again.`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="accessRole">Role</Label>
              <Select value={accessRole} onValueChange={(v) => setAccessRole(v as Role)}>
                <SelectTrigger id="accessRole" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-ink">
                Labs (for Lab Leaders / Contributors)
              </span>
              <div className="flex flex-wrap gap-4">
                {labs.map((lab) => (
                  <label
                    key={lab.id}
                    className="flex items-center gap-2 text-sm text-ink-soft"
                  >
                    <Checkbox
                      checked={accessLabs.has(lab.id)}
                      onCheckedChange={(c) => toggleAccessLab(lab.id, c === true)}
                    />
                    {lab.name}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAccessDialogUser(null)}>
              Cancel
            </Button>
            <Button onClick={saveAccess} disabled={savingAccess}>
              {savingAccess ? "Saving\u2026" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- create / edit KB entry dialog ---------- */}
      <Dialog open={kbDialogOpen} onOpenChange={setKbDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{kbEditing ? "Edit knowledge base entry" : "Add knowledge base entry"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitKb} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="kbTitle">Title</Label>
              <Input
                id="kbTitle"
                placeholder="Entry title, e.g. Faith Lab three-tier pricing"
                required
                value={kbTitle}
                onChange={(e) => setKbTitle(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="kbLab">Lab</Label>
              <Select value={kbLab} onValueChange={setKbLab}>
                <SelectTrigger id="kbLab" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_LAB}>All labs (org-wide)</SelectItem>
                  {labs.map((lab) => (
                    <SelectItem key={lab.id} value={lab.id}>
                      {lab.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="kbContent">Content</Label>
              <Textarea
                id="kbContent"
                rows={6}
                placeholder="The framework, guidance, or example text itself…"
                required
                value={kbContent}
                onChange={(e) => setKbContent(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setKbDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={kbSaving}>
                {kbSaving ? "Saving…" : kbEditing ? "Save changes" : "Add entry"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
