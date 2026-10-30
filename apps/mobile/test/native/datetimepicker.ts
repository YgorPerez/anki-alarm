// @react-native-community/datetimepicker opens Android's own dialogs. Tests get the pickers a screen
// opened, newest last, and answer one as the user would.
interface PickerProps {
  mode?: "date" | "time";
  value: Date;
  is24Hour?: boolean;
  minimumDate?: Date;
  onValueChange?: (event: object, date: Date) => void;
  onDismiss?: () => void;
}
export const pickers: PickerProps[] = [];
export const DateTimePickerAndroid = {
  open: (props: PickerProps) => {
    pickers.push(props);
  },
  dismiss: () => {},
};
/** Sets the newest picker to `date` and presses OK. */
export function answerPicker(date: Date) {
  const picker = pickers.at(-1);
  if (!picker) throw new Error("No picker open");
  picker.onValueChange?.({ type: "set" }, date);
}
