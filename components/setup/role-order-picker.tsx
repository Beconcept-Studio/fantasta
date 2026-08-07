"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  restrictToParentElement,
  restrictToVerticalAxis,
} from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronUp, GripVertical } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ROLE_LABELS, type Role } from "@/lib/domain";

/**
 * L'ordine dei ruoli, riordinabile (PLAN §11, Fase 1).
 *
 * Il valore vero viaggia in un `input hidden` come "C,A,P,D": il drag & drop è
 * un'affordance, non il canale dati. Accanto alla maniglia ci sono due frecce,
 * perché trascinare quattro righe col pollice su un telefono è più difficile
 * che premere un pulsante — e perché la tastiera deve poter fare tutto.
 *
 * Il primo elemento della lista **è** il ruolo da cui parte l'asta: non c'è una
 * seconda scelta all'avvio.
 */
export function RoleOrderPicker({
  name = "roleOrder",
  defaultValue,
  disabled = false,
}: {
  name?: string;
  defaultValue: Role[];
  disabled?: boolean;
}) {
  const [order, setOrder] = useState<Role[]>(defaultValue);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setOrder((current) => {
      const from = current.indexOf(active.id as Role);
      const to = current.indexOf(over.id as Role);
      return arrayMove(current, from, to);
    });
  }

  function move(role: Role, delta: number) {
    setOrder((current) => {
      const from = current.indexOf(role);
      const to = from + delta;
      if (to < 0 || to >= current.length) return current;
      return arrayMove(current, from, to);
    });
  }

  return (
    <div className="space-y-2">
      <input type="hidden" name={name} value={order.join(",")} />
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          <ol className="space-y-2">
            {order.map((role, index) => (
              <SortableRole
                key={role}
                role={role}
                position={index + 1}
                isFirst={index === 0}
                isLast={index === order.length - 1}
                disabled={disabled}
                onMove={(delta) => move(role, delta)}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      <p className="text-muted-foreground text-xs">
        L&apos;asta parte da <strong>{ROLE_LABELS[order[0]]}</strong> e prosegue
        in quest&apos;ordine.
      </p>
    </div>
  );
}

function SortableRole({
  role,
  position,
  isFirst,
  isLast,
  disabled,
  onMove,
}: {
  role: Role;
  position: number;
  isFirst: boolean;
  isLast: boolean;
  disabled: boolean;
  onMove: (delta: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: role, disabled });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`bg-card flex items-center gap-3 rounded-md border p-2 ${
        isDragging ? "z-10 shadow-lg" : ""
      }`}
    >
      <button
        type="button"
        className="text-muted-foreground touch-none disabled:opacity-40"
        aria-label={`Trascina ${ROLE_LABELS[role]}`}
        disabled={disabled}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>

      <span className="text-muted-foreground w-5 text-sm tabular-nums">
        {position}.
      </span>
      <span className="flex-1 text-sm font-medium">
        {ROLE_LABELS[role]}{" "}
        <span className="text-muted-foreground font-mono">({role})</span>
      </span>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8"
        aria-label={`Sposta ${ROLE_LABELS[role]} in su`}
        disabled={disabled || isFirst}
        onClick={() => onMove(-1)}
      >
        <ChevronUp className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8"
        aria-label={`Sposta ${ROLE_LABELS[role]} in giù`}
        disabled={disabled || isLast}
        onClick={() => onMove(1)}
      >
        <ChevronDown className="size-4" />
      </Button>
    </li>
  );
}
