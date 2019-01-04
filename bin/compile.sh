#!/usr/bin/env bash

# colors
NC='\033[0m' # No Color
RED='\033[0;31m'
GREEN='\033[0;32m'
LGREEN='\033[1;32m'
LBLUE='\033[1;34m'
LCYAN='\033[1;36m'

if [ "$1" == "help" ] || [ "$1" == "-h" ] || [ "$1" == "--help" ]; then
    echo "Args:"
    echo "    -c CONTRACT_NAME  (note: include the .sol)"
    echo "    -d CONTRACT_DIR  (note: full path will be ./CONTRACT_DIR/CONTRACT_NAME)"
    echo "    -o OUTPUT_DIR  (e.g. _solDist)"
    exit 1
fi

# getopts
CONTRACT_NAME="UNKNOWN.sol"
CONTRACT_DIR="contracts"
OUTPUT_DIR="_solDist"
while getopts ":c:d:o:" opt; do
    case $opt in
        c)
            CONTRACT_NAME="$OPTARG"
        ;;
        d)
            CONTRACT_DIR="$OPTARG"
        ;;
        o)
            OUTPUT_DIR="$OPTARG"
        ;;
        \?)
            echo "invalid option -$OPTARG"
            exit 1
        ;;
        :)
            echo "Option -$OPTARG requires an argument"
            exit 1
        ;;
    esac
done

# params
CONTRACT_PATH="./$CONTRACT_DIR/$CONTRACT_NAME"

if [ $(pwd | grep "bin") ]; then
    echo -e 'Please run this with Yarn from the source root.\n'
    echo -e 'Usage: yarn sol-compile\n'
    exit 1
fi

if [ ! $(command -v solc) ]; then
    echo -e "${RED}Error:${NC} 'solc' not found.\n"=
    echo -e "Please see: http://solidity.readthedocs.io/en/develop/installing-solidity.html\n"
    exit 1
fi

if [ ! -e "$CONTRACT_PATH" ]; then
    echo -e "${RED}Error:${NC} Cannot find $CONTRACT_PATH\n"
    echo -e "Are you running this from ./ with yarn?\n"
    exit 1
fi

mkdir -p "./$OUTPUT_DIR"

if [[ "$NO_SOLC_LIBS" == "" ]]; then
  LIB_STR=$(cat ./bin/libs.txt | tr '\n' ' ')
else
  LIB_STR=""
fi

function solcCommon {
    solc "$@" -o "./$OUTPUT_DIR/" --overwrite --optimize "$CONTRACT_PATH" --libraries "$LIB_STR" --allow-paths './ens,./contracts,./libs,'
}


echo -e "${LGREEN}>>> Starting solidity compilation of $CONTRACT_NAME <<<${NC}\n"

if solcCommon --bin --abi ; then
    echo -e "${LGREEN}Solidity compilation of $CONTRACT_NAME succeeded.${NC}"
    cp "${OUTPUT_DIR}/${CONTRACT_NAME%.sol}.abi" "${OUTPUT_DIR}/${CONTRACT_NAME%.sol}.abi.json"
else
    echo -e "${RED}ERROR: Solidity compilation of $CONTRACT_NAME failed${NC}"
    exit 1;
fi

SOLC_VERSION=$(solc --version | grep Version | cut -d ' ' -f 2)

C_NAME_NO_SOL=$(echo "$CONTRACT_NAME" | cut -d '.' -f 1)

echo -e "\n${LCYAN}>>> Smart Contract Verification Details <<<${NC}\n"
echo -e "Contract Name: ${LCYAN}$C_NAME_NO_SOL${NC}"
echo -e "Solc Version: ${LCYAN}$SOLC_VERSION${NC}"
echo -e "Optimization: ${LCYAN}Enabled${NC}"
echo -e "Contract code: ${LCYAN}$CONTRACT_PATH${NC}\n"
