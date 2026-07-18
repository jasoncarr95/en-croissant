import { Text } from "@mantine/core";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

function NoDatabaseWarning() {
  const { t } = useTranslation();

  return (
    <>
      <Text>{t("Board.Database.NoSelection")}</Text>
      <Text>
        <Link to="/databases">{t("Board.Database.AddDatabase")}</Link>
      </Text>
    </>
  );
}

export default NoDatabaseWarning;
