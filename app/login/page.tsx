'use client';

import { useState, useActionState, Suspense } from 'react';
import { authenticate } from '@/app/actions/auth';
import { useSearchParams } from 'next/navigation';

function LoginForm() {
  const [errorMessage, dispatch] = useActionState(authenticate, undefined);
  const searchParams = useSearchParams();
  const registered = searchParams.get('registered');

  return (
    <div className="max-w-md w-full p-8 bg-gray-800 rounded-xl shadow-xl">
      <h2 className="text-2xl font-bold text-center mb-6">Login to AlphaBoard</h2>
      
      {registered && (
        <div className="bg-green-500/10 border border-green-500/50 text-green-400 p-3 rounded mb-4 text-sm text-center">
          Registration successful! Please log in.
        </div>
      )}

      {errorMessage && (
        <div className="bg-red-500/10 border border-red-500/50 text-red-500 p-3 rounded mb-4 text-sm">
          {errorMessage}
        </div>
      )}
      
      <form action={dispatch} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-400 mb-1">Email</label>
          <input 
            name="email" 
            type="email" 
            required 
            className="w-full bg-gray-900 border border-gray-700 rounded px-4 py-2 focus:outline-none focus:border-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-400 mb-1">Password</label>
          <input 
            name="password" 
            type="password" 
            required 
            className="w-full bg-gray-900 border border-gray-700 rounded px-4 py-2 focus:outline-none focus:border-blue-500"
          />
        </div>
        
        <button 
          type="submit" 
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded transition-colors"
        >
          Log In
        </button>
      </form>
      
      <p className="mt-4 text-center text-sm text-gray-400">
        Don't have an account? <a href="/register" className="text-blue-500 hover:underline">Sign up</a>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">
      <Suspense fallback={<div className="p-8">Loading...</div>}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
