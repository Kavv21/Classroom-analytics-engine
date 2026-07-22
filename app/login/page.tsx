import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";

export default function LoginPage() {
  return (
    <main className="page-spacious">
      <h1 className="title-lg">Sign in</h1>
      <p className="lede mt-3">
        Use your university Google account. If you&rsquo;re a student, your
        professor adds you to a class roster before your first sign-in.
      </p>
      <div className="mt-8">
        <GoogleSignInButton />
      </div>
    </main>
  );
}
