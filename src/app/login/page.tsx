import { Login } from "@/production/components/login";
import { getRuntime } from "@/production/server/runtime";
import { isEmailDisabled } from "@/production/server/email-mode";
export const dynamic = "force-dynamic";
export default function Page() {
  return <Login emailDisabled={isEmailDisabled(getRuntime())} />;
}
