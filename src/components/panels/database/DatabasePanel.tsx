import {
  Alert,
  Group,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Tabs,
  Text,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { Link } from "@tanstack/react-router";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { memo, useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr/immutable";
import { match } from "ts-pattern";
import { useStore } from "zustand";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import { currentTabAtom, referenceDbAtom, sessionsAtom } from "@/state/atoms";
import {
  adoptReferenceDatabaseAtom,
  canQueryDatabaseExplorer,
  type DatabasePanelTab,
  type DatabaseSource,
  currentDatabaseExplorerInitializedAtom,
  currentDbTabAtom,
  currentDbTypeAtom,
  currentLichessOptionsAtom,
  currentLocalOptionsAtom,
  currentMasterOptionsAtom,
  initializeDatabaseExplorerStateAtom,
  setCurrentLocalDatabaseAtom,
  syncCurrentLocalFenAtom,
} from "@/state/databaseExplorer";
import {
  getDatabases,
  type LocalOptions,
  type Opening,
  query_games,
  searchPosition,
} from "@/utils/db";
import { formatNumber } from "@/utils/format";
import { convertToNormalized, getLichessGames, getMasterGames } from "@/utils/lichess/api";
import type { LichessGamesOptions, MasterGamesOptions } from "@/utils/lichess/explorer";
import DatabaseLoader from "./DatabaseLoader";
import GamesTable from "./GamesTable";
import NoDatabaseWarning from "./NoDatabaseWarning";
import OpeningsTable from "./OpeningsTable";
import LichessOptionsPanel from "./options/LichessOptionsPanel";
import LocalOptionsPanel from "./options/LocalOptionsPanel";
import MasterOptionsPanel from "./options/MastersOptionsPanel";

type DBType =
  | { type: "local"; options: LocalOptions }
  | {
      type: "lch_all";
      options: LichessGamesOptions;
      fen: string;
      token: string;
    }
  | {
      type: "lch_master";
      options: MasterGamesOptions;
      fen: string;
      token: string;
    };

function sortOpenings(openings: Opening[]) {
  return openings.sort((a, b) => b.total - a.total);
}

async function fetchOpening(db: DBType, tab: string) {
  return match(db)
    .with({ type: "lch_all" }, async ({ fen, options, token }) => {
      const data = await getLichessGames(fen, options, token);
      return {
        openings: data.moves.map((move) => ({
          move: move.san,
          total: move.white + move.black + move.draws,
          white: move.white,
          black: move.black,
          draw: move.draws,
        })),
        games: await convertToNormalized(data.topGames || data.recentGames || []),
      };
    })
    .with({ type: "lch_master" }, async ({ fen, options, token }) => {
      const data = await getMasterGames(fen, options, token);
      return {
        openings: data.moves.map((move) => ({
          move: move.san,
          total: move.white + move.black + move.draws,
          white: move.white,
          black: move.black,
          draw: move.draws,
        })),
        games: await convertToNormalized(data.topGames || data.recentGames || []),
      };
    })
    .with({ type: "local" }, async ({ options }) => {
      if (!options.path) throw Error("Missing reference database");
      const positionData = await searchPosition(options, tab);
      return {
        openings: sortOpenings(positionData[0]),
        games: positionData[1],
      };
    })
    .exhaustive();
}

function DatabasePanel() {
  const { t } = useTranslation();

  const treeStore = useContext(TreeStateContext)!;
  const fen = useStore(treeStore, (state) => state.currentNode().fen);
  const [debouncedFen] = useDebouncedValue(fen, 50);
  const sessions = useAtomValue(sessionsAtom);
  const referenceDatabase = useAtomValue(referenceDbAtom);
  const tab = useAtomValue(currentTabAtom);
  const tabId = tab?.value ?? null;

  const initialized = useAtomValue(currentDatabaseExplorerInitializedAtom);
  const lichessOptions = useAtomValue(currentLichessOptionsAtom);
  const masterOptions = useAtomValue(currentMasterOptionsAtom);
  const localOptions = useAtomValue(currentLocalOptionsAtom);
  const [db, setDb] = useAtom(currentDbTypeAtom);
  const [tabType, setTabType] = useAtom(currentDbTabAtom);

  const initializeExplorer = useSetAtom(initializeDatabaseExplorerStateAtom);
  const adoptReferenceDatabase = useSetAtom(adoptReferenceDatabaseAtom);
  const setLocalDatabase = useSetAtom(setCurrentLocalDatabaseAtom);
  const syncLocalFen = useSetAtom(syncCurrentLocalFenAtom);

  const explorerToken = sessions.find((session) => session.lichess?.accessToken)?.lichess
    ?.accessToken;
  const missingExplorerToken = db !== "local" && !explorerToken;

  const { data: databases } = useSWR(db === "local" ? "databases" : null, () => getDatabases());

  const dbSelectData = (databases ?? [])
    .filter((database) => database.type === "success")
    .map((database) => ({
      value: database.file,
      label: database.title || database.filename,
    }));

  useEffect(() => {
    if (tabId && !initialized) initializeExplorer(tabId);
  }, [tabId, initialized, initializeExplorer]);

  useEffect(() => {
    if (tabId && !localOptions.path) adoptReferenceDatabase(referenceDatabase);
  }, [tabId, localOptions.path, referenceDatabase, adoptReferenceDatabase]);

  useEffect(() => {
    if (db === "local") syncLocalFen(debouncedFen);
  }, [db, debouncedFen, syncLocalFen]);

  const dbType: DBType = match(db)
    .with("local", (v) => ({
      type: v,
      options: localOptions,
    }))
    .with("lch_all", (v) => ({
      type: v,
      options: lichessOptions,
      fen: debouncedFen,
      token: explorerToken ?? "",
    }))
    .with("lch_master", (v) => ({
      type: v,
      options: masterOptions,
      fen: debouncedFen,
      token: explorerToken ?? "",
    }))
    .exhaustive();

  const canQuery = canQueryDatabaseExplorer({
    initialized,
    panel: tabType,
    source: db,
    localPath: localOptions.path,
    missingExplorerToken,
  });
  const hasLocalPosition = Boolean(localOptions.position?.fen);

  const [gamesPagination, setGamesPagination] = useState({ key: "", page: 1 });
  const localGamesKey = JSON.stringify(localOptions);
  const gamesPage = gamesPagination.key === localGamesKey ? gamesPagination.page : 1;
  const {
    data: localGames,
    isLoading: gamesLoading,
    error: gamesError,
  } = useSWR(
    canQuery && db === "local" && tabType === "games" && hasLocalPosition
      ? (["position-games", localOptions, gamesPage] as const)
      : null,
    ([, options, page]) =>
      query_games(options.path!, {
        ...options,
        sides: options.sides ?? "WhiteBlack",
        options: { page, pageSize: 20, skipCount: false, sort: "averageElo", direction: "desc" },
      }),
  );

  const {
    data: openingData,
    isLoading,
    error,
  } = useSWR(
    canQuery && (db !== "local" || (tabType === "stats" && hasLocalPosition)) ? dbType : null,
    async (currentDbType: DBType) => {
      return fetchOpening(currentDbType, tabId ?? "");
    },
  );

  const grandTotal = openingData?.openings?.reduce((acc, curr) => acc + curr.total, 0);

  const header = (
    <>
      <Group justify="space-between" w="100%" wrap="nowrap">
        <Group>
          <SegmentedControl
            data={[
              { label: t("Board.Database.Local"), value: "local" },
              { label: t("Board.Database.LichessAll"), value: "lch_all" },
              { label: t("Board.Database.LichessMaster"), value: "lch_master" },
            ]}
            value={db}
            onChange={(value) => setDb(value as "local" | "lch_all" | "lch_master")}
          />

          {db === "local" && (
            <Select
              data={dbSelectData}
              value={localOptions.path}
              onChange={setLocalDatabase}
              placeholder={t("Board.Database.SelectDatabase")}
              size="sm"
              flex={1}
              maw={200}
              allowDeselect={false}
            />
          )}
        </Group>

        {tabType !== "options" && (
          <Text style={{ whiteSpace: "nowrap" }}>
            {t("Board.Database.Matches", {
              matches: formatNumber(
                db === "local" && tabType === "games"
                  ? (localGames?.count ?? 0)
                  : Math.max(grandTotal || 0, openingData?.games.length || 0),
              ),
            })}
          </Text>
        )}
      </Group>
      <DatabaseLoader isLoading={isLoading || gamesLoading} tab={tab?.value ?? null} />
    </>
  );

  return (
    <Stack h="100%" gap={0}>
      <Tabs
        defaultValue="stats"
        orientation="vertical"
        placement="right"
        value={tabType}
        onChange={(v) => setTabType(v as DatabasePanelTab)}
        display="flex"
        flex={1}
        style={{ overflow: "hidden" }}
      >
        <Tabs.List>
          <Tabs.Tab value="stats">{t("Board.Database.Stats")}</Tabs.Tab>
          <Tabs.Tab value="games">{t("Board.Database.Games")}</Tabs.Tab>
          <Tabs.Tab value="options">{t("Board.Database.Options")}</Tabs.Tab>
        </Tabs.List>

        <PanelWithError
          value="stats"
          error={error}
          type={db}
          header={header}
          missingExplorerToken={missingExplorerToken}
          missingLocalDatabase={dbType.type === "local" && !dbType.options.path}
        >
          <OpeningsTable openings={openingData?.openings || []} loading={isLoading} fen={fen} />
        </PanelWithError>
        <PanelWithError
          value="games"
          error={db === "local" ? gamesError : error}
          type={db}
          header={header}
          missingExplorerToken={missingExplorerToken}
          missingLocalDatabase={dbType.type === "local" && !dbType.options.path}
        >
          <GamesTable
            games={db === "local" ? localGames?.data || [] : openingData?.games || []}
            loading={db === "local" ? gamesLoading : isLoading}
            databasePath={dbType.type === "local" ? dbType.options.path : null}
            pagination={
              db === "local"
                ? {
                    page: gamesPage,
                    totalRecords: localGames?.count ?? 0,
                    onPageChange: (page) => setGamesPagination({ key: localGamesKey, page }),
                  }
                : undefined
            }
          />
        </PanelWithError>
        <PanelWithError
          value="options"
          error={error}
          type={db}
          header={header}
          missingExplorerToken={missingExplorerToken}
          missingLocalDatabase={dbType.type === "local" && !dbType.options.path}
        >
          <ScrollArea flex={1} offsetScrollbars pt="sm">
            {match(db)
              .with(
                "local",
                () => localOptions.path && <LocalOptionsPanel file={localOptions.path} />,
              )
              .with("lch_all", () => <LichessOptionsPanel />)
              .with("lch_master", () => <MasterOptionsPanel />)
              .exhaustive()}
          </ScrollArea>
        </PanelWithError>
      </Tabs>
    </Stack>
  );
}

function PanelWithError(props: {
  value: string;
  error: unknown;
  type: DatabaseSource;
  header: React.ReactNode;
  children: React.ReactNode;
  missingExplorerToken: boolean;
  missingLocalDatabase: boolean;
}) {
  const { t } = useTranslation();
  let children = props.children;

  if (props.missingLocalDatabase) {
    children = <NoDatabaseWarning />;
  } else if (props.missingExplorerToken && props.type !== "local") {
    children = (
      <Alert color="yellow">
        {t("Board.Database.ExplorerAuthRequired1")} <Link to="/accounts">Users</Link>{" "}
        {t("Board.Database.ExplorerAuthRequired2")}
      </Alert>
    );
  } else if (props.error) {
    children = <Alert color="red">{String(props.error)}</Alert>;
  }

  return (
    <Tabs.Panel
      py="xs"
      px="sm"
      value={props.value}
      flex={1}
      style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}
    >
      {props.header}
      {children}
    </Tabs.Panel>
  );
}

export default memo(DatabasePanel);
