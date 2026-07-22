import { SignOutButton } from "@/components/auth/sign-out-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function NotProvisionedPage() {
  return (
    <main className="page-spacious">
      <Card>
        <CardHeader>
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
    </main>
  );
}
