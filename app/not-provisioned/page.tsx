import { SignOutButton } from "@/components/auth/sign-out-button";

export default function NotProvisionedPage() {
  return (
    <main className="page-spacious">
      <h1 className="title-lg">You&rsquo;re signed in, but not on a roster yet</h1>
      <p className="lede mt-4">
        We couldn&rsquo;t find your university email on any class roster, so
        there are no assignments to show you.
      </p>
      <p className="note mt-3">
        Ask your professor to add you to their class. Once they have, sign in
        again and your assignments will appear.
      </p>
      <div className="mt-8">
        <SignOutButton />
      </div>
    </main>
  );
}
