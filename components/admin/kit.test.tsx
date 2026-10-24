// @vitest-environment jsdom
// The admin kit: the table's empty, loading and error states, the pager's arithmetic, and the small pieces' props.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "../test-utils";
import { Avatar, DataTable, Pager, type Column } from "./DataTable";
import { AdminPage, Badge, Button, Checkbox, Empty, Field, Input, KeyValues, Notice, Section, Select, Stat, StatGrid } from "./kit";

interface Row {
  id: string;
  name: string;
}

const columns: Column<Row>[] = [
  { key: "name", header: "Name", cell: (r) => r.name },
  { key: "id", header: "ID", cell: (r) => r.id, className: "w-0" },
];

describe("DataTable", () => {
  it("renders a row per item and calls onRowClick with it", () => {
    const onRowClick = vi.fn();
    render(<DataTable columns={columns} rows={[{ id: "a", name: "Ada" }, { id: "b", name: "Lin" }]} rowKey={(r) => r.id} onRowClick={onRowClick} />);
    expect(screen.getByText("Name")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Lin"));
    expect(onRowClick).toHaveBeenCalledWith({ id: "b", name: "Lin" });
  });

  it("says why there are no rows: error, then loading, then empty", () => {
    const { rerender } = render(<DataTable columns={columns} rows={[]} rowKey={(r) => r.id} error="boom" loading />);
    expect(screen.getByText("boom")).toBeInTheDocument();
    rerender(<DataTable columns={columns} rows={[]} rowKey={(r) => r.id} loading />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    rerender(<DataTable columns={columns} rows={[]} rowKey={(r) => r.id} empty="No one yet." />);
    expect(screen.getByText("No one yet.")).toBeInTheDocument();
    rerender(<DataTable columns={columns} rows={[]} rowKey={(r) => r.id} />);
    expect(screen.getByText("Nothing here yet.")).toBeInTheDocument();
  });

  it("keeps the rows and shows the error under them when a reload fails", () => {
    render(<DataTable columns={columns} rows={[{ id: "a", name: "Ada" }]} rowKey={(r) => r.id} error="reload failed" loading />);
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("reload failed")).toBeInTheDocument();
  });
});

describe("Pager", () => {
  it("hides while everything fits on one page", () => {
    const { container } = render(<Pager skip={0} take={20} total={20} onSkip={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the range and steps a page at a time", () => {
    const onSkip = vi.fn();
    render(<Pager skip={20} take={20} total={45} onSkip={onSkip} />);
    expect(screen.getByText("21–40 of 45")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Next →"));
    expect(onSkip).toHaveBeenLastCalledWith(40);
    fireEvent.click(screen.getByText("← Prev"));
    expect(onSkip).toHaveBeenLastCalledWith(0);
  });

  it("disables Prev on the first page and Next on the last", () => {
    const { rerender } = render(<Pager skip={0} take={20} total={45} onSkip={vi.fn()} />);
    expect(screen.getByText("← Prev")).toBeDisabled();
    rerender(<Pager skip={40} take={20} total={45} onSkip={vi.fn()} />);
    expect(screen.getByText("41–45 of 45")).toBeInTheDocument();
    expect(screen.getByText("Next →")).toBeDisabled();
  });
});

describe("Avatar", () => {
  it("shows the picture, or the name's initial without one", () => {
    const { container, rerender } = render(<Avatar src="https://img/a.png" name="Ada" />);
    expect(container.querySelector("img")).toHaveAttribute("src", "https://img/a.png");
    rerender(<Avatar src={null} name="lin" />);
    expect(screen.getByText("l")).toBeInTheDocument();
    rerender(<Avatar src={null} name="  " />);
    expect(screen.getByText("?")).toBeInTheDocument();
  });
});

describe("kit pieces", () => {
  it("lays out a page with its title, subtitle, actions and content", () => {
    render(
      <AdminPage title="Users" subtitle="3 accounts" actions={<Button>Export</Button>} wide>
        <Section title="Plan" note="Pro monthly" actions={<Button variant="primary">Upgrade</Button>}>
          body
        </Section>
        <Section tone="danger" title="Reset" />
        <Section>untitled</Section>
      </AdminPage>,
    );
    expect(screen.getByRole("heading", { name: "Users" })).toBeInTheDocument();
    expect(screen.getByText("3 accounts")).toBeInTheDocument();
    expect(screen.getByText("Pro monthly")).toBeInTheDocument();
    expect(screen.getByText("Reset")).toHaveClass("text-danger");
    expect(screen.getByText("untitled")).toBeInTheDocument();
  });

  it("renders stats, badges, notices, empty states and key-value rows", () => {
    render(
      <>
        <StatGrid>
          <Stat label="Users" value={12} hint="3 this week" />
          <Stat label="Data dir" value="~/.weft" mono />
        </StatGrid>
        <Badge tone="ok" title="live">live</Badge>
        <Badge>free</Badge>
        <Notice tone="danger">failed</Notice>
        <Empty>Pick one.</Empty>
        <KeyValues rows={[["Customer", "cus_1"]]} />
      </>,
    );
    expect(screen.getByText("3 this week")).toBeInTheDocument();
    expect(screen.getByText("~/.weft")).toHaveClass("font-mono");
    expect(screen.getByText("live")).toHaveClass("text-ok");
    expect(screen.getByText("free")).toHaveClass("text-muted");
    expect(screen.getByText("failed")).toHaveClass("text-danger");
    expect(screen.getByText("Pick one.")).toBeInTheDocument();
    expect(screen.getByText("cus_1")).toBeInTheDocument();
  });

  it("wires the form controls", () => {
    const onChange = vi.fn();
    const onClick = vi.fn();
    render(
      <>
        <Field label="Code">
          <Input placeholder="WEFT" className="w-20" />
        </Field>
        <Select aria-label="Mode" defaultValue="test">
          <option value="test">test</option>
        </Select>
        <Checkbox label="Cancel first" checked={false} onChange={onChange} />
        <Button size="sm" variant="danger" onClick={onClick}>
          Void
        </Button>
      </>,
    );
    expect(screen.getByLabelText("Code")).toHaveClass("w-20");
    expect(screen.getByLabelText("Mode")).toHaveValue("test");
    fireEvent.click(screen.getByLabelText("Cancel first"));
    expect(onChange).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByText("Void"));
    expect(onClick).toHaveBeenCalled();
    expect(screen.getByText("Void")).toHaveAttribute("type", "button");
  });
});
