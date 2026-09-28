'use client';

import { useActionState, Suspense } from 'react';
import { authenticate } from '@/app/actions/auth';
import { useSearchParams } from 'next/navigation';

function LoginForm() {
  const [errorMessage, dispatch] = useActionState(authenticate, undefined);
  const searchParams = useSearchParams();
  const registered = searchParams.get('registered');

  return (
    <div className="panel w-full max-w-md p-8">
      <p className="mb-6 text-center font-display text-2xl font-extrabold text-ink">AlphaBoard</p>
      <h2 className="mb-6 text-center text-lg font-bold text-ink">Login to AlphaBoard</h2>

      {registered && (
        <div className="mb-4 rounded-lg bg-up-soft p-3 text-center text-sm text-up">
          Registration successful! Please log in.
        </div>
      )}

      {errorMessage && (
        <div className="mb-4 rounded-lg bg-down-soft p-3 text-sm text-down">
          {errorMessage}
        </div>
      )}

      <form action={dispatch} className="space-y-4">
        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-semibold text-ink-2">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            required
            className="w-full rounded-lg border border-line bg-paper px-4 py-2 text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="password" className="mb-1 block text-sm font-semibold text-ink-2">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            required
            className="w-full rounded-lg border border-line bg-paper px-4 py-2 text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
          />
        </div>

        <button
          type="submit"
          className="w-full rounded-lg bg-ink px-4 py-2.5 font-bold text-paper transition-colors hover:bg-[#23313f]"
        >
          Log In
        </button>
      </form>

      <p className="mt-4 text-center text-sm text-ink-3">
        No account yet? Ask an administrator for an invite link.
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-page p-4 text-ink">
      <Suspense fallback={<div className="p-8 text-ink-3">Loading...</div>}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
