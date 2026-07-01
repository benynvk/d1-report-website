'use client';

import {
  createContext,
  useCallback,
  useContext,
  useState,
} from 'react';

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

type Resolver = (ok: boolean) => void;

const ConfirmContext = createContext<
  (opts: ConfirmOptions) => Promise<boolean>
>(() => Promise.resolve(false));

export function useConfirm() {
  return useContext(ConfirmContext);
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{
    opts: ConfirmOptions;
    resolve: Resolver;
  } | null>(null);

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setState({ opts, resolve });
    });
  }, []);

  const close = (ok: boolean) => {
    state?.resolve(ok);
    setState(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <div className="modal-overlay" onClick={() => close(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {state.opts.title && <h3>{state.opts.title}</h3>}
            <p>{state.opts.message}</p>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => close(false)}>
                {state.opts.cancelLabel ?? 'Cancel'}
              </button>
              <button
                className={`btn${state.opts.danger ? ' solid-danger' : ''}`}
                onClick={() => close(true)}
              >
                {state.opts.confirmLabel ?? 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
