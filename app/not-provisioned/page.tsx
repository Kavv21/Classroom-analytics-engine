import { SignOutButton } from "@/components/auth/sign-out-button";

export default function NotProvisionedPage() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-bold">Your account isn&apos;t set up for this yet</h1>
      <p className="mt-4 text-gray-700">
        Your account isn&apos;t set up for this yet — ask your professor to add you
        to a class roster.
      </p>
      <p className="mt-2 text-sm text-gray-500">
        You signed in successfully, but there&apos;s no roster entry for your
        university email yet. Once your professor adds you to a class
        roster, sign in again and you&apos;ll get access.
      </p>
      <div className="mt-6">
        <SignOutButton />
      </div>
    </main>
  );
}
