import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";

export default function LoginPage() {
  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-2xl font-bold">Sign in</h1>
      <p className="mt-2 text-gray-600">
        Sign in with your university Google account to continue.
      </p>
      <div className="mt-6">
        <GoogleSignInButton />
      </div>
    </main>
  );
}
