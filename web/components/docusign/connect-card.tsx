"use client";

/* Admin-only "Connect DocuSign" card — same shape as invoices/page.tsx's
   QboCard: not-configured / not-connected / connected states, a full-page
   redirect for the one-time consent grant, and disconnect behind a confirm
   dialog. Lives on the Contracts page because DocuSign is contract-adjacent
   (unlike QuickBooks, which lives with invoices). */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { api } from "@/lib/api";
import type { DocuSignStatus } from "@/lib/types";

export function DocuSignConnectCard() {
  const [status, setStatus] = useState<DocuSignStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    setStatusError(null);
    try {
      setStatus(await api<DocuSignStatus>("/docusign/status"));
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "DocuSign status unavailable.");
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  async function connect() {
    setConnecting(true);
    try {
      const { url } = await api<{ url: string }>("/docusign/connect");
      window.location.href = url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start the DocuSign connection.");
      setConnecting(false);
    }
  }

  async function disconnect() {
    setDisconnecting(true);
    try {
      await api("/docusign/disconnect", { method: "POST" });
      setConfirmOpen(false);
      toast.success(
        "Disconnected from DocuSign. New contracts will be sent using the Portal's own signature capture until it's reconnected."
      );
      await loadStatus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not disconnect from DocuSign.");
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-serif text-lg">DocuSign</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {statusLoading ? (
          <p className="text-sm text-ink-mute">Checking DocuSign connection…</p>
        ) : statusError ? (
          <p className="text-sm text-ink-mute">DocuSign status unavailable ({statusError}).</p>
        ) : !status?.configured ? (
          <p className="text-sm text-ink-mute">
            Not configured yet. Add the DocuSign integration credentials to SSM parameter{" "}
            <code className="rounded bg-violet-pale px-1 py-0.5 text-xs">
              /ol-portal/docusign-credentials
            </code>{" "}
            and redeploy the backend to enable connecting.
          </p>
        ) : !status.connected ? (
          <>
            <p className="text-sm text-ink-mute">
              Connect the Portal to DocuSign ({status.env}) so contracts, MSAs, and task orders can
              be sent for signature through DocuSign instead of the Portal&apos;s own signature
              capture. Until connected, sending works exactly as it does today.
            </p>
            <Button onClick={connect} disabled={connecting} className="w-fit">
              {connecting ? "Connecting…" : "Connect to DocuSign"}
            </Button>
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-ink-mute">
              Connected to DocuSign ({status.env}), account {status.accountId}.
              {status.impersonatedUserEmail && ` Sending as ${status.impersonatedUserEmail}.`}
            </p>
            <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  Disconnect
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Disconnect from DocuSign?</DialogTitle>
                  <DialogDescription>
                    New contracts will go back to using the Portal&apos;s own signature capture
                    until it&apos;s reconnected. Documents already sent through DocuSign keep
                    tracking normally.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                    Cancel
                  </Button>
                  <Button variant="destructive" onClick={disconnect} disabled={disconnecting}>
                    {disconnecting ? "Disconnecting…" : "Disconnect"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
