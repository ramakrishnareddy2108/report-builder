import { MonitorX } from 'lucide-react';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function UnsupportedBrowser() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <Card className="max-w-md">
        <CardHeader>
          <MonitorX className="mb-2 size-8 text-destructive" />
          <CardTitle>Please use Chrome or Edge</CardTitle>
          <CardDescription>
            This app saves your work in a folder on your computer, and this browser cannot open
            folders. Open this page in Google Chrome or Microsoft Edge on a desktop or laptop.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
