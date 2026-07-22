import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function LoginPage() {
  return (
    <main className="page-spacious">
      <Card>
        <CardHeader>
          {/* h1: this card carries the page's only heading. */}
          <CardTitle as="h1" className="title-lg">
            Sign in
          </CardTitle>
          <CardDescription className="text-base">
            Use your university Google account. If you&rsquo;re a student, your
            professor adds you to a class roster before your first sign-in.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <GoogleSignInButton />
        </CardContent>
      </Card>
    </main>
  );
}
