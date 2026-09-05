import { HugeiconsIcon } from '@hugeicons/react';
import {
  GithubIcon,
  Add01Icon,
  ArrowUp02Icon,
  ArrowUpRight01Icon,
  ArrowDown01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Tick02Icon,
  Clock01Icon,
  CloudIcon,
  DashboardSquare01Icon,
  FilterHorizontalIcon,
  Flag01Icon,
  Folder01Icon,
  GitBranchIcon,
  GitMergeIcon,
  Globe02Icon,
  InformationCircleIcon,
  Link01Icon,
  Menu01Icon,
  Message01Icon,
  MoreHorizontalIcon,
  Notification01Icon,
  PlayIcon,
  Search01Icon,
  Settings01Icon,
  Shield01Icon,
  SidebarLeftIcon,
  SparklesIcon,
  UserGroupIcon,
  UserIcon,
  ViewIcon,
  Loading03Icon,
} from '@hugeicons/core-free-icons';
const icons = {
  github: GithubIcon,
  add: Add01Icon,
  up: ArrowUp02Icon,
  external: ArrowUpRight01Icon,
  down: ArrowDown01Icon,
  right: ArrowRight01Icon,
  close: Cancel01Icon,
  complete: CheckmarkCircle02Icon,
  check: Tick02Icon,
  clock: Clock01Icon,
  cloud: CloudIcon,
  board: DashboardSquare01Icon,
  filter: FilterHorizontalIcon,
  search: Search01Icon,
  flag: Flag01Icon,
  folder: Folder01Icon,
  branch: GitBranchIcon,
  merge: GitMergeIcon,
  globe: Globe02Icon,
  info: InformationCircleIcon,
  link: Link01Icon,
  menu: Menu01Icon,
  message: Message01Icon,
  more: MoreHorizontalIcon,
  attention: Notification01Icon,
  play: PlayIcon,
  settings: Settings01Icon,
  shield: Shield01Icon,
  sidebar: SidebarLeftIcon,
  sparkles: SparklesIcon,
  people: UserGroupIcon,
  person: UserIcon,
  view: ViewIcon,
  loading: Loading03Icon,
};
export type IconName = keyof typeof icons;
export function Icon({
  name,
  size = 20,
  className = '',
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <HugeiconsIcon
      icon={icons[name]}
      size={size}
      strokeWidth={1.8}
      className={`icon icon-${name} ${className}`}
      aria-hidden="true"
    />
  );
}
