import { SignOutButton } from "@/components/auth/sign-out-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function NotProvisionedPage() {
  return (
    <main className="page-spacious">
      {/* Lifted like the sign-in card: the three entry screens
          (login / not-provisioned / receipt) share one shape. */}
      <Card className="shadow-lifted">
        <CardHeader>
          <p className="eyebrow mb-2">Evaluating Energy Sources</p>
          <CardTitle as="h1" className="title-lg">
            You&rsquo;re signed in, but not on a roster yet
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertTitle>We couldn&rsquo;t find your email on any class roster</AlertTitle>
            <AlertDescription>
              That&rsquo;s why there are no assignments to show you.
            </AlertDescription>
          </Alert>
          <p className="note">
            Ask your professor to add you to their class. Once they have, sign
            in again and your assignments will appear.
          </p>
          <SignOutButton />
        </CardContent>
      </Card>
      {/* text-ink-secondary, not the .eyebrow default: this line sits
          directly on the peach backdrop rather than on a card, and the
          muted ink is only 3.88:1 there (secondary is 5.44:1). Every other
          .eyebrow in this app is on a white surface, where muted is 6.2:1
          and correct. */}
      <p className="eyebrow mt-8 text-center text-ink-secondary">
        © Jinraj Joshipura 1994
      </p>
    </main>
  );
}
