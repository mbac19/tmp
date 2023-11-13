import "./rows.css";

import classNames from "classnames";

import React, {
  MutableRefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { assert, undefinedThrows } from "@fifr/lib_error";
import {
  buildIndexPath,
  calculateIndexPathPosition,
  RowsIndexPath,
} from "./rows_index_path";
import {
  cloneSelectionState,
  makeEmptyRowsSelectionState,
  RowsSelectionState,
} from "./rows_selection_state";
import {
  IRowsSelectionController,
  RowsSelectionController,
} from "./rows_selection_controller";
import { usePrevious } from "@/common/use_previous";

export interface RowsClasses {
  root?: string;
  rowsContainer?: string;
  highlight?: string;
  highlightBar?: string;
}

const REACH_END_BUFFER = 80;

export interface RowProps {
  /**
   * If true, this will automatically highlight the first row. Auto-highlighting
   * will take place when this component is initially mounted (if there is a
   * row to display) or any other time the component goes from having no rows
   * to some rows. Note that if this is true, "maintainHighlight" should also
   * be true.
   */
  autoHighlightFirstRow?: boolean;

  /**
   * TODO (FIF-473)
   *
   * It's possible that the caller selects a row index path that is
   * out-of-bounds. This may happen if the selection doesn't change but some
   * rows are filtered out. If this value is set to true, we will clamp
   * the selection so that it will choose the closest row if no row exists
   * at the selected index path. Default is false.
   */
  clampSelectionToClosestRow?: boolean;

  classes?: RowsClasses;

  className?: string;

  /**
   * Can choose an initial selection when the component is first initialized.
   * Changing this value after the initial render will not cause any changes
   * to the selection.
   */
  initialSelection?: RowsSelectionState;

  /**
   * Given the index of a row, return true if that row can be selected. If
   * this is not provided, all rows can be selected.
   *
   * @param {number} rowIndex
   */
  canSelectRow?: (indexPath: Readonly<RowsIndexPath>) => boolean;

  /**
   * Get the number of rows in a particular section.
   */
  getRowCount: (sectionIndex: number) => number;

  /**
   * If true, we want to maintain the highlight even when our mouse leaves
   * the component. In this case, the highlight will be maintained on the
   * last row that was being highlighted. If false, the highlight disappears
   * when the mouse leaves the component.
   */
  maintainHighlight: boolean;

  /**
   * This callback is executed when a user chooses a row. We treat choosing
   * as distinct from "selection".
   */
  onChooseRow?: (indexPath: RowsIndexPath) => void;

  /**
   * A callback that is executed when the user scrolls near the end of the
   * list of rows.
   */
  onDidReachEnd?: () => void;

  /**
   * Listen for changes to selections and highlights of rows.
   */
  onSelectionChange?: (selection: RowsSelectionState) => void;

  /**
   * Given the index path of a row, return the JSX to render the content for
   * that row.
   *
   * @param {RowsIndexPath} indexPath
   * @param {boolean} isHighlighted
   */
  renderRow: (
    indexPath: Readonly<RowsIndexPath>,
    isHighlighted: boolean
  ) => React.ReactNode;

  /**
   * Given the index of the section, return the JSX to render the content for
   * that section header. If "sectionHeaderHeight" is defined, then this
   * must also be defined.
   */
  renderSectionHeader?: (sectionIndex: number) => React.ReactNode;

  /**
   * Can be used to provide a top header component. This is a single
   * component that shows at the top of the rows, above all sections. Must
   * define "topSectionHeader" if defining this.
   */
  renderTopHeader?: () => React.ReactNode;

  /**
   * The height of each row.
   */
  rowHeight: number;

  /**
   * The number of sections in the list of rows. Each section is a group of
   * rows and contains a list of rows beneath it.
   */
  sectionCount: number;

  /**
   * The height of each section header. If "renderSectionHeader" is defined,
   * then this must also be defined.
   */
  sectionHeaderHeight?: number;

  /**
   * Get a reference to the selection controller, which can be used to access
   * an imperative API for update selections.
   */
  selectionControllerRef?: MutableRefObject<
    IRowsSelectionController | undefined
  >;

  /**
   * Must be defined if using the "renderTopHeader" callback.
   */
  topHeaderHeight?: number;
}

export function Rows(props: RowProps) {
  assert(
    props.autoHighlightFirstRow !== true || props.maintainHighlight === true,
    "Cannot auto highlight first row if 'maintainHighlight' is not set to true."
  );

  // ---------------------------------------------------------------------------
  // STATE
  // ---------------------------------------------------------------------------

  const initialSelection = useRef(props.initialSelection);

  const selectionController = useMemo<RowsSelectionController>(() => {
    return new RowsSelectionController(
      initialSelection.current ?? makeEmptyRowsSelectionState()
    );
  }, []);

  const prevSelectionController = usePrevious(selectionController);

  const [selectionState, setSelectionState] = useState(
    props.initialSelection ?? makeEmptyRowsSelectionState()
  );

  const scrollState = useRef<{ didReachEnd: boolean }>({ didReachEnd: false });

  const scrollElementRef = useRef<HTMLDivElement>(null);

  const highlightTop = useMemo<number | undefined>(() => {
    if (selectionState.highlightedRow === undefined) return undefined;

    return calculateIndexPathPosition(
      props.topHeaderHeight,
      props.sectionHeaderHeight ?? 0,
      props.rowHeight,
      selectionState.highlightedRow
    );
  }, [
    props.sectionHeaderHeight,
    props.rowHeight,
    props.topHeaderHeight,
    selectionState,
  ]);

  // ---------------------------------------------------------------------------
  // INDEX PATH
  // ---------------------------------------------------------------------------

  /**
   * A index path object that is reused as we iterate through the rows and pass
   * the index path location to the parent component.
   */
  const reusableIndexPath = useRef<RowsIndexPath>({
    absoluteRowIndex: 0,
    rowIndex: 0,
    sectionIndex: 0,
  });

  function resetIndexPath(indexPath: RowsIndexPath) {
    indexPath.absoluteRowIndex = 0;
    indexPath.rowIndex = 0;
    indexPath.sectionIndex = 0;
  }

  // ---------------------------------------------------------------------------
  // EVENT HANDLERS
  // ---------------------------------------------------------------------------

  const { onSelectionChange: _onSelectionChange } = props;

  const onChangeSelectionState = useCallback(
    (selection: RowsSelectionState) => {
      setSelectionState(cloneSelectionState(selection));

      if (_onSelectionChange !== undefined) _onSelectionChange(selection);
    },
    [_onSelectionChange]
  );

  function onClickRow(indexPath: Readonly<RowsIndexPath>) {
    if (props.onChooseRow === undefined) return;
    props.onChooseRow(indexPath);
  }

  function onScroll(event: React.UIEvent<HTMLDivElement>) {
    const scrollElement = scrollElementRef.current;

    if (!scrollElement) {
      scrollState.current.didReachEnd = false;
      return;
    }

    const distanceToBottom =
      scrollElement.scrollHeight -
      scrollElement.scrollTop -
      scrollElement.clientHeight;

    const didReachEnd = distanceToBottom < REACH_END_BUFFER;

    if (scrollState.current.didReachEnd !== didReachEnd) {
      scrollState.current.didReachEnd = didReachEnd;
      if (didReachEnd && props.onDidReachEnd) {
        props.onDidReachEnd();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // SIDE EFFECTS
  // ---------------------------------------------------------------------------

  /**
   * Set the selection controller ref provided by the parent component.
   */
  useEffect(
    function registerSelectionController() {
      if (props.selectionControllerRef !== undefined) {
        props.selectionControllerRef.current = selectionController;
      }
    },
    [selectionController, props.selectionControllerRef]
  );

  /**
   * Need to frequently handle cleaning up the selection controller when
   * we are hot-reloading in the development environment. We will get weird
   * bugs with the selection if we have 2 controllers simultaneously registered
   * for events on the same scroll element.
   */
  useEffect(
    function cleanupPreviousSelectionController() {
      if (
        prevSelectionController &&
        prevSelectionController !== selectionController
      ) {
        prevSelectionController.scrollElement = undefined;
      }
    },
    [prevSelectionController, selectionController]
  );

  /**
   * Listen for changes to properties related to selection and update the
   * selection controller when they change.
   */
  useEffect(
    function updateSelectionController() {
      if (!selectionController) {
        return;
      }

      selectionController.autoHighlightFirstRow =
        props.autoHighlightFirstRow ?? false;
      selectionController.canSelectRow = props.canSelectRow;
      selectionController.maintainHighlight = props.maintainHighlight;
      selectionController.onChangeSelectionState = onChangeSelectionState;
      selectionController.onChooseRow = props.onChooseRow;
      selectionController.sectionHeaderHeight = props.sectionHeaderHeight;
      selectionController.rowHeight = props.rowHeight;
      selectionController.sectionCount = props.sectionCount;
      selectionController.topHeaderHeight = props.topHeaderHeight;
      selectionController.getRowCount = props.getRowCount;

      selectionController.updateSelectionState();
    },
    [
      selectionController,
      props.canSelectRow,
      props.autoHighlightFirstRow,
      props.maintainHighlight,
      props.onChooseRow,
      props.sectionCount,
      props.getRowCount,
      props.rowHeight,
      props.sectionHeaderHeight,
      onChangeSelectionState,
      props.topHeaderHeight,
    ]
  );

  useEffect(
    function updateScrollElement() {
      if (!selectionController) {
        return;
      }
      selectionController.scrollElement = scrollElementRef.current ?? undefined;
    },
    [selectionController, scrollElementRef]
  );

  // ---------------------------------------------------------------------------
  // RENDER
  // ---------------------------------------------------------------------------

  const rowComponents: React.ReactNode[] = [];

  const indexPath = reusableIndexPath.current;

  const rowComponentStyle = {
    height: `${props.rowHeight}px`,
    minHeight: `${props.rowHeight}px`,
  };

  resetIndexPath(indexPath);

  if (props.renderTopHeader) {
    undefinedThrows(
      props.topHeaderHeight,
      `topHeaderHeight must be defined when renderTopHeader is defined`
    );

    rowComponents.push(
      <div
        key="TopHeader"
        style={{
          height: `${props.topHeaderHeight}px`,
          minHeight: `${props.topHeaderHeight}px`,
        }}
      >
        {props.renderTopHeader()}
      </div>
    );
  }

  for (
    let sectionIndex = 0;
    sectionIndex < props.sectionCount;
    ++sectionIndex
  ) {
    const rowCount = props.getRowCount(sectionIndex);
    indexPath.sectionIndex = sectionIndex;

    if (
      props.sectionHeaderHeight !== undefined &&
      props.sectionHeaderHeight > 0 &&
      props.renderSectionHeader !== undefined
    ) {
      rowComponents.push(
        <div
          key={`Section:${indexPath.sectionIndex}`}
          style={{
            height: `${props.sectionHeaderHeight}px`,
            minHeight: `${props.sectionHeaderHeight}px`,
          }}
        >
          {props.renderSectionHeader(sectionIndex)}
        </div>
      );
    }

    for (let rowIndex = 0; rowIndex < rowCount; ++rowIndex) {
      indexPath.rowIndex = rowIndex;

      rowComponents.push(
        <div
          className="Rows-Row"
          key={`Row:${indexPath.absoluteRowIndex}`}
          onClick={() => {
            onClickRow(
              buildIndexPath(
                props.sectionCount,
                props.getRowCount,
                sectionIndex,
                rowIndex
              )
            );
          }}
          style={rowComponentStyle}
        >
          {props.renderRow(indexPath, isHighlighted(selectionState, indexPath))}
        </div>
      );

      ++indexPath.absoluteRowIndex;
    }
  }

  return (
    <div
      className={classNames(props.className, "Rows-Root")}
      onScroll={onScroll}
      ref={scrollElementRef}
    >
      <div
        className={classNames("Rows-Container", props.classes?.rowsContainer)}
      >
        <div
          className={classNames("Rows-Highlight", props.classes?.highlight)}
          style={{
            display: highlightTop === undefined ? "none" : "block",
            height: `${props.rowHeight - 1}px`,
            top: `${highlightTop ?? 0}px`,
          }}
        >
          <div
            className={classNames(
              "Rows-HighlightBar",
              props.classes?.highlightBar
            )}
          />
        </div>
        {rowComponents}
      </div>
    </div>
  );
}

function isHighlighted(
  selectionState: RowsSelectionState,
  indexPath: Readonly<RowsIndexPath>
): boolean {
  return (
    selectionState.highlightedRow?.absoluteRowIndex ===
    indexPath.absoluteRowIndex
  );
}

