"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { ApiError, STEP_UP_REQUIRED_ERROR } from "@/lib/client/api";
import { StepUpDialog } from "@/components/step-up-dialog";

type RunWithStepUp = <T>(action: () => Promise<T>) => Promise<T>;

const StepUpContext = createContext<RunWithStepUp | null>(null);

/**
 * Wraps a subtree so any write can be run via useStepUp()'s runWithStepUp():
 * if the server responds STEP_UP_REQUIRED (the address opted into signed
 * writes and has no live step-up cookie), this opens the confirm-with-wallet
 * dialog and, once signed, transparently retries the original action. Writes
 * from addresses that haven't opted in never trigger it.
 */
export function StepUpProvider({
  namespace,
  address,
  children,
}: {
  namespace: string;
  address: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // The action awaiting a fresh signature, plus its promise handles, held in
  // a ref so re-renders don't drop the pending retry.
  const pending = useRef<{
    action: () => Promise<unknown>;
    resolve: (v: unknown) => void;
    reject: (e: unknown) => void;
  } | null>(null);

  const runWithStepUp = useCallback(function runWithStepUp<T>(action: () => Promise<T>): Promise<T> {
    return action().catch((err) => {
      if (err instanceof ApiError && err.message === STEP_UP_REQUIRED_ERROR) {
        return new Promise<T>((resolve, reject) => {
          pending.current = {
            action,
            resolve: resolve as (v: unknown) => void,
            reject,
          };
          setOpen(true);
        });
      }
      throw err;
    });
  }, []);

  function handleConfirmed() {
    const p = pending.current;
    pending.current = null;
    if (!p) return;
    // Step-up cookie is now set; retry once. A second failure surfaces normally.
    p.action().then(p.resolve, p.reject);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next && pending.current) {
      // Dialog dismissed without confirming - reject so the caller's catch
      // runs (and its finally clears any loading state) instead of hanging.
      pending.current.reject(new ApiError("Signature required to continue.", 403));
      pending.current = null;
    }
  }

  return (
    <StepUpContext.Provider value={runWithStepUp}>
      {children}
      <StepUpDialog
        namespace={namespace}
        address={address}
        open={open}
        onOpenChange={handleOpenChange}
        onConfirmed={handleConfirmed}
      />
    </StepUpContext.Provider>
  );
}

/** Returns runWithStepUp; outside a provider it's a passthrough (no step-up). */
export function useStepUp(): RunWithStepUp {
  const ctx = useContext(StepUpContext);
  return ctx ?? ((action) => action());
}
