import { Box } from "@mantine/core";
import { useAtom } from "jotai";
import { GameFilters } from "@/components/databases/GameFilters";
import { currentLocalFiltersAtom } from "@/state/databaseExplorer";

function LocalOptionsPanel({ file }: { file: string }) {
  const [filters, setFilters] = useAtom(currentLocalFiltersAtom);

  return (
    <Box px="xs">
      <GameFilters
        query={filters}
        setQuery={setFilters}
        file={file}
        hidePositionSearch
        alwaysExpanded
      />
    </Box>
  );
}

export default LocalOptionsPanel;
