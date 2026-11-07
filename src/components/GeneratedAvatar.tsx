import { avatarMarkup, avatarSpec, type AvatarPerson } from "@/lib/avatar";

type Props = {
  person: AvatarPerson;
  className?: string;
};

export function GeneratedAvatar({ person, className }: Props) {
  const spec = avatarSpec(person);
  const cls = className ? `generated-avatar ${className}` : "generated-avatar";
  return (
    <span
      className={cls}
      style={{ ["--swatch-hue" as string]: String(spec.hue) }}
      aria-hidden
      dangerouslySetInnerHTML={{ __html: avatarMarkup(spec) }}
    />
  );
}
