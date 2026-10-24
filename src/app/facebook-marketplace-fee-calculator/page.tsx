import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("facebook-marketplace");

export default function Page() {
  return (
    <CalculatorPage slug="facebook-marketplace">
      <Ui />
    </CalculatorPage>
  );
}
