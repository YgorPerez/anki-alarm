import type { LucideIcon } from "lucide-react-native";
import { useResolveClassNames } from "uniwind";

/** A Lucide icon in a theme text color; SVG can't take a class name. */
export function ThemedIcon({
  icon: Glyph,
  colorClassName = "text-foreground",
  size = 24,
}: {
  icon: LucideIcon;
  colorClassName?: string;
  size?: number;
}) {
  const { color } = useResolveClassNames(colorClassName);
  return <Glyph size={size} color={color} strokeWidth={1.8} />;
}
