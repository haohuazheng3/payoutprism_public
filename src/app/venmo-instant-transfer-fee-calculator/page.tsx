import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("venmo-instant-transfer");

export default function Page() {
  return (
    <CalculatorPage slug="venmo-instant-transfer">
      <Ui />
    </CalculatorPage>
  );
}
