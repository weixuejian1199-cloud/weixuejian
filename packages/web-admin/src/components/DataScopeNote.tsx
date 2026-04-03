import { Info } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface DataScopeNoteProps {
  source: string
  sync?: string
  note?: string
  className?: string
}

/** 板块级「数据从哪来、多久更新」说明，供定稿期产品与调研对齐，后续可接真实元数据 */
export function DataScopeNote({
  source,
  sync,
  note,
  className,
}: DataScopeNoteProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-dashed border-muted-foreground/25 bg-muted/30 px-4 py-3 text-sm',
        className,
      )}
    >
      <div className="flex gap-2">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="space-y-1.5 text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">数据来源：</span>
            {source}
          </p>
          {sync ? (
            <p>
              <span className="font-medium text-foreground">同步节奏：</span>
              {sync}
            </p>
          ) : null}
          {note ? <p>{note}</p> : null}
        </div>
      </div>
    </div>
  )
}
